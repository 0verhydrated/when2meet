export function renderAuth(container, { signup, onSubmit, loginUrl, signupUrl, homeUrl, unavailable = '' }) {
  container.innerHTML = `<div class="auth-panel"><h1 id="app-heading">${signup ? '회원가입' : '로그인'}</h1><p>${signup ? '이메일과 비밀번호로 가입하고 바로 시작하세요. 이메일 인증은 필요하지 않습니다.' : '가입한 이메일과 비밀번호를 입력해 주세요.'}</p><form id="auth-form">${signup ? '<div class="field"><label for="auth-name">이름</label><input id="auth-name" name="name" autocomplete="nickname" maxlength="30" required></div>' : ''}<div class="field"><label for="auth-email">이메일</label><input id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" required></div><div class="field"><label for="auth-password">비밀번호</label><input id="auth-password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="12" maxlength="128" required aria-describedby="password-help"></div><p class="helper" id="password-help">비밀번호는 12~128자로 입력해 주세요.</p>${signup ? '<div class="field"><label for="auth-confirm">비밀번호 확인</label><input id="auth-confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div>' : ''}<p id="auth-status" class="inline-status error" role="alert"></p><div class="form-actions"><button class="button" type="submit">${signup ? '가입하기' : '로그인'}</button></div></form><p class="privacy-note"><a id="auth-switch" href="${signup ? loginUrl : signupUrl}">${signup ? '이미 계정이 있나요? 로그인' : '처음이신가요? 회원가입'}</a></p><a class="back-link" href="${homeUrl}">홈으로 돌아가기</a></div>`;
  const status = container.querySelector('#auth-status');
  status.textContent = unavailable;
  if (unavailable) { container.querySelector('button[type="submit"]').disabled = true; container.querySelectorAll('input').forEach(input => { input.disabled = true; }); }
  container.querySelector('#auth-form').onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    if (signup && values.password !== container.querySelector('#auth-confirm').value) { status.textContent = '비밀번호가 일치하지 않습니다.'; container.querySelector('#auth-confirm').focus(); return; }
    const button = event.submitter; button.disabled = true; button.textContent = '처리 중…'; status.textContent = '';
    try { await onSubmit(values); }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; button.textContent = signup ? '가입하기' : '로그인'; }
  };
}
