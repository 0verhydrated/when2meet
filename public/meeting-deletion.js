const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function openMeetingDeletion(meeting, api, onDeleted) {
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'deletion-dialog';
  dialog.setAttribute('aria-labelledby', 'deletion-heading');
  dialog.setAttribute('aria-describedby', 'deletion-description');
  dialog.innerHTML = `<form><h2 id="deletion-heading"></h2><p class="helper">${escape(meeting.title)}</p><p id="deletion-description"></p><div class="field"><label for="deletion-password">삭제 비밀번호</label><input id="deletion-password" name="password" type="password" required minlength="8" maxlength="128" autocomplete="off" autofocus></div><p id="deletion-status" class="inline-status error" role="status"></p><div class="form-actions"><button class="quiet-button" type="button" id="cancel-deletion">취소</button><button class="button danger-button" type="submit" id="confirm-deletion"></button></div></form>`;
  const form = dialog.querySelector('form'), input = form.elements.password, submit = form.querySelector('[type=submit]'), cancel = form.querySelector('#cancel-deletion'), message = form.querySelector('#deletion-status');
  let busy = false;
  const render = () => {
    dialog.querySelector('#deletion-heading').textContent = meeting.has_delete_password ? '약속을 삭제할까요?' : '삭제 비밀번호를 설정해 주세요';
    dialog.querySelector('#deletion-description').textContent = meeting.has_delete_password ? '처음 설정한 삭제 비밀번호를 입력해 주세요. 삭제 후에는 참여 링크로 접근할 수 없어요.' : '이전에 만든 약속에는 삭제 비밀번호가 없어요. 8~128자로 설정한 뒤 삭제할 수 있어요.';
    submit.textContent = meeting.has_delete_password ? '약속 삭제' : '비밀번호 설정';
  };
  cancel.onclick = () => dialog.close();
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.onkeydown = event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('input, button')].filter(element => !element.disabled);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  dialog.onclose = () => { input.value = ''; dialog.remove(); if (opener?.isConnected) opener.focus(); };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; submit.disabled = true; cancel.disabled = true; message.textContent = '';
    try {
      if (!meeting.has_delete_password) {
        await api('/meetings/' + meeting.id + '/delete-password', { method: 'POST', body: JSON.stringify({ password: input.value }) });
        meeting.has_delete_password = true; input.value = ''; render();
        message.textContent = '비밀번호를 설정했어요. 삭제하려면 다시 입력해 주세요.'; input.focus();
      } else {
        await api('/meetings/' + meeting.id, { method: 'DELETE', body: JSON.stringify({ password: input.value }) });
        dialog.close(); onDeleted();
      }
    } catch (error) { message.textContent = error.message; input.value = ''; input.focus(); }
    finally { busy = false; submit.disabled = false; cancel.disabled = false; }
  };
  render(); document.body.append(dialog); dialog.showModal();
}
