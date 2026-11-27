export function createDialog(markup) {
  const opener = document.activeElement, dialog = document.createElement('dialog');
  dialog.className = 'app-dialog'; dialog.innerHTML = markup;
  dialog.setAttribute('aria-labelledby', dialog.querySelector('h2').id);
  dialog.onkeydown = event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('input, select, button')].filter(element => !element.disabled && !element.hidden);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  dialog.addEventListener('close', () => {
    for (const input of dialog.querySelectorAll('input')) input.value = '';
    dialog.remove(); if (opener?.isConnected) opener.focus();
  });
  document.body.append(dialog); return dialog;
}
