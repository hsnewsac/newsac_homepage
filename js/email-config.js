/* =========================================================
   신청 완료 이메일 자동 발송 (EmailJS)
   ✅ 설정 완료: 세 값이 모두 따옴표 안에 입력되어 있어야 합니다.
========================================================= */
export const EMAILJS = {
  publicKey: "DknDJGqx1rzW27_CV",
  serviceId: "service_jqaqp6k",
  templateId: "template_159qnew"
};

export function emailEnabled(){
  return !!(EMAILJS.publicKey && EMAILJS.serviceId && EMAILJS.templateId);
}

/**
 * 신청 접수 확인 메일 발송
 * @param {Object} p - 템플릿 변수
 *   to_email, name, org, org_type, phone,
 *   program, course, app_id, date
 * @returns {Promise<{ok:boolean, skipped?:boolean, error?:any}>}
 */
export async function sendApplicationEmail(p){
  if (!emailEnabled()) return { ok: false, skipped: true };
  try {
    const emailjs = (await import('https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm')).default;
    emailjs.init({ publicKey: EMAILJS.publicKey });
    await emailjs.send(EMAILJS.serviceId, EMAILJS.templateId, p);
    return { ok: true };
  } catch (error) {
    console.error('이메일 발송 실패:', error);
    return { ok: false, error };
  }
}
