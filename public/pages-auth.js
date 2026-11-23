import './demo.js';
import { renderAuth } from './auth-ui.js';

const mode = new URLSearchParams(location.search).get('auth');
if (['signup', 'login'].includes(mode)) {
  document.querySelector('#home-view').hidden = true;
  document.querySelector('#app-view').hidden = false;
  renderAuth(document.querySelector('#app-content'), { signup: mode === 'signup', loginUrl: './?auth=login', signupUrl: './?auth=signup', homeUrl: './', unavailable: '회원가입 서버가 아직 연결되지 않았습니다. 현재는 계정을 만들 수 없습니다.' });
}
