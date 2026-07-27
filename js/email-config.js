/* =========================================================
   신청 완료 이메일 자동 발송 (EmailJS)
   ▼ EmailJS 가입 후 아래 세 값을 채우면 발송이 활성화됩니다.
     비워두면 이메일 발송만 건너뛰고 신청은 정상 접수됩니다.
   자세한 설정 방법: 이메일알림_설정가이드.md 참고
========================================================= */
export const EMAILJS = {
  publicKey: "",   // EmailJS → Account → General → Public Key
  serviceId: "",   // EmailJS → Email Services → Service ID
  templateId: ""   // EmailJS → Email Templates → Template ID
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
