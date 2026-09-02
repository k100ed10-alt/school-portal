/* Cloud Functions — توليد رموز الاشتراك بعد الدفع عبر ثواني */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret, defineString} = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const THAWANI_SECRET = defineSecret("THAWANI_SECRET_KEY");        // sk_test_... أو sk_live_...
const THAWANI_PUBLIC = defineSecret("THAWANI_PUBLISHABLE_KEY");   // pk_test_... أو pk_live_...
const THAWANI_MODE   = defineString("THAWANI_MODE",  {default: "uat"});   // uat أو live
const ADMIN_EMAIL    = defineString("ADMIN_EMAIL",   {default: "teacher@example.com"});

const host = () => (THAWANI_MODE.value() === "live"
  ? "https://checkout.thawani.om"
  : "https://uatcheckout.thawani.om");

const opts = {secrets: [THAWANI_SECRET, THAWANI_PUBLIC], cors: true};

function makeCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) { s += A[Math.floor(Math.random() * A.length)]; if (i === 3) s += "-"; }
  return s;
}
async function uniqueCode() {
  for (let i = 0; i < 8; i++) {
    const c = makeCode();
    const snap = await db.collection("codes").doc(c).get();
    if (!snap.exists) return c;
  }
  throw new HttpsError("internal", "code-generation-failed");
}
const SUBJECTS = {
  math: "الرياضيات", science: "العلوم", arabic: "اللغة العربية",
  islamic: "التربية الإسلامية", social: "الدراسات الاجتماعية", english: "اللغة الإنجليزية"
};
const clean = (s, n) => String(s || "").trim().slice(0, n);
const isAdmin = (req) => req.auth && req.auth.token && req.auth.token.email === ADMIN_EMAIL.value();

/* ---------- ١) إنشاء جلسة دفع في ثواني ---------- */
exports.createPayment = onCall(opts, async (req) => {
  const name = clean(req.data.name, 60);
  const phone = clean(req.data.phone, 20).replace(/\D/g, "");
  const origin = clean(req.data.origin, 200);
  if (!name || phone.length < 7) throw new HttpsError("invalid-argument", "اكتب اسمك ورقمك أولًا.");
  if (!/^https?:\/\//.test(origin)) throw new HttpsError("invalid-argument", "bad-origin");

  const st = await db.doc("private/settings").get();
  const cfg = st.exists ? st.data() : {};
  const perSubject = (cfg.prices || {})[subject];
  const amount = Math.max(100, perSubject || cfg.priceBaisa || 3000); // بالبيسة

  const ref = db.collection("payments").doc();
  const body = {
    client_reference_id: ref.id,
    mode: "payment",
    products: [{name: "اشتراك " + SUBJECTS[subject], quantity: 1, unit_amount: amount}],
    success_url: `${origin}?ref=${ref.id}`,
    cancel_url: `${origin}?cancelled=1`,
    metadata: {student: name, phone, subject}
  };

  const r = await fetch(`${host()}/api/v1/checkout/session`, {
    method: "POST",
    headers: {"Content-Type": "application/json", "thawani-api-key": THAWANI_SECRET.value()},
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!j.success || !j.data || !j.data.session_id) {
    console.error("thawani create session failed", j);
    throw new HttpsError("internal", "تعذّر فتح صفحة الدفع.");
  }

  await ref.set({
    sessionId: j.data.session_id, name, phone, amount, subject,
    status: "pending", code: null, createdAt: Date.now()
  });

  return {url: `${host()}/pay/${j.data.session_id}?key=${THAWANI_PUBLIC.value()}`, ref: ref.id};
});

/* ---------- ٢) التحقق من الدفع وتوليد الرمز ---------- */
exports.claimCode = onCall(opts, async (req) => {
  const id = clean(req.data.ref, 40);
  const ref = db.collection("payments").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "عملية الدفع غير معروفة.");
  const pay = snap.data();
  if (pay.code) return {code: pay.code, subject: pay.subject || ""};   // إعادة التحميل لا تولّد رمزًا جديدًا

  const r = await fetch(`${host()}/api/v1/checkout/session/${pay.sessionId}`, {
    headers: {"thawani-api-key": THAWANI_SECRET.value()}
  });
  const j = await r.json();
  const status = j && j.data && j.data.payment_status;
  if (!j.success || status !== "paid") {
    throw new HttpsError("failed-precondition", "لم يكتمل الدفع بعد. إن كنت قد دفعت فانتظر لحظات وأعد المحاولة.");
  }

  const code = await uniqueCode();
  await db.collection("codes").doc(code).set({
    paid: true, name: pay.name, phone: pay.phone, boundPhone: "",
    subject: pay.subject || "", sessionId: pay.sessionId,
    amount: pay.amount, createdAt: Date.now()
  });
  await ref.update({status: "paid", code});
  return {code, subject: pay.subject || ""};
});

/* ---------- ٣) التحقق من رمز الدخول ---------- */
exports.verifyAccess = onCall({cors: true}, async (req) => {
  const portal = req.data.portal === "paid" ? "paid" : "free";
  const code = clean(req.data.code, 20).toUpperCase();
  const name = clean(req.data.name, 60);
  const phone = clean(req.data.phone, 20).replace(/\D/g, "");

  if (portal === "free") {
    const st = await db.doc("private/settings").get();
    const real = String((st.exists && st.data().freeCode) || "").toUpperCase();
    if (!real || code !== real) throw new HttpsError("permission-denied", "رمز الدخول غير صحيح. راجع معلّمك.");
    return {ok: true};
  }

  const cRef = db.collection("codes").doc(code);
  const c = await cRef.get();
  if (!c.exists) throw new HttpsError("permission-denied", "رمز الاشتراك غير صحيح.");
  const d = c.data();
  if (d.boundPhone && d.boundPhone !== phone) {
    throw new HttpsError("permission-denied", "هذا الرمز مسجّل باسم مشترك آخر.");
  }
  if (!d.boundPhone) await cRef.update({boundPhone: phone, name: name || d.name, usedAt: Date.now()});

  const paid = await db.doc("private/paid").get();
  const all = paid.exists ? (paid.data().lessons || {}) : {};
  const sub = d.subject || "";
  const lessons = {};
  if (sub && all[sub]) lessons[sub] = all[sub];
  return {ok: true, subjects: sub ? [sub] : [], portal: {lessons}};
});

/* ---------- ٤) إصدار رمز يدوي (للمعلّم فقط) ---------- */
exports.issueCode = onCall({cors: true}, async (req) => {
  if (!isAdmin(req)) throw new HttpsError("permission-denied", "admin-only");
  const subject = clean(req.data.subject, 20);
  if (!SUBJECTS[subject]) throw new HttpsError("invalid-argument", "اختر المادة.");
  const code = await uniqueCode();
  await db.collection("codes").doc(code).set({
    paid: false, name: clean(req.data.name, 60) || "—", phone: "", boundPhone: "",
    subject, createdAt: Date.now()
  });
  return {code, subject};
});
