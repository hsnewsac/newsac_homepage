/* =========================================================
   자동 메일 발송 (EmailJS)  v5
   ✅ 신청 접수 확인 메일 : templateId      (설정 완료)
   ⬜ 수료 안내 메일      : templateCertId  (선택 — 비워두면 발송을 건너뜁니다)

   수료 메일을 쓰려면 EmailJS에서 템플릿을 하나 더 만들고
   아래 templateCertId 에 붙여넣으세요. 사용 가능한 변수는
   sendCertificateEmail() 주석을 참고하세요.
========================================================= */
export const EMAILJS = {
  publicKey:        "DknDJGqx1rzW27_CV",
  serviceId:        "service_jqaqp6k",
  templateId:       "template_159qnew",
  templateCertId:   "",          // ← 수료 안내 메일 템플릿 ID (예: "template_cert01")
  templateStatusId: ""           // ← 배정 결과 안내 메일 템플릿 ID (예: "template_assign01")
};

export function emailEnabled(){
  return !!(EMAILJS.publicKey && EMAILJS.serviceId && EMAILJS.templateId);
}
export function certEmailEnabled(){
  return !!(EMAILJS.publicKey && EMAILJS.serviceId && EMAILJS.templateCertId);
}
export function statusEmailEnabled(){
  return !!(EMAILJS.publicKey && EMAILJS.serviceId && EMAILJS.templateStatusId);
}

let _emailjs = null;
async function getClient(){
  if (_emailjs) return _emailjs;
  _emailjs = (await import('https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm')).default;
  _emailjs.init({ publicKey: EMAILJS.publicKey });
  return _emailjs;
}

/**
 * 신청 접수 확인 메일
 * 템플릿 변수: to_email, name, org, org_type, phone, program, course, app_id, date
 */
export async function sendApplicationEmail(p){
  if (!emailEnabled()) return { ok: false, skipped: true };
  try {
    const emailjs = await getClient();
    await emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, p);
    return { ok: true };
  } catch (error) {
    console.error('신청 메일 발송 실패:', error);
    return { ok: false, error };
  }
}

/**
 * 수료 안내 메일 (관리자가 수료 처리했을 때)
 * 템플릿 변수: to_email, name, program, course, cert_no, cert_url, date
 */
export async function sendCertificateEmail(p){
  if (!certEmailEnabled()) return { ok: false, skipped: true };
  try {
    const emailjs = await getClient();
    await emailjs.send(EMAILJS.serviceId, EMAILJS.templateCertId, p);
    return { ok: true };
  } catch (error) {
    console.error('수료 메일 발송 실패:', error);
    return { ok: false, error };
  }
}

/**
 * 배정 결과 안내 메일 (검토중 / 배정확정 / 반려)
 * 템플릿 변수: to_email, name, program, course, status, status_desc,
 *              assign_place, assign_period, assign_sessions, assign_hours, memo, date
 */
export async function sendStatusEmail(p){
  if (!statusEmailEnabled()) return { ok: false, skipped: true };
  try {
    const emailjs = await getClient();
    await emailjs.send(EMAILJS.serviceId, EMAILJS.templateStatusId, p);
    return { ok: true };
  } catch (error) {
    console.error('배정 결과 메일 발송 실패:', error);
    return { ok: false, error };
  }
}
