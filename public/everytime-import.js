const days = ['월', '화', '수', '목', '금', '토', '일'];
const timeLabel = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const key = item => JSON.stringify([item.name.trim(), item.weekday, item.start, item.end]);

export function mergeImportedFixed(existing, imported) {
  const seen = new Set(existing.map(key));
  const added = imported.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
  if (existing.length + added.length > 50) throw new Error('고정 일정은 최대 50개까지 저장할 수 있어요. 가져올 수업을 줄여 주세요.');
  return { items: [...existing, ...added.map(item => ({ ...item, id: crypto.randomUUID() }))], added: added.length };
}

export function mountEverytimeImport(container, { request, current, save, onSaved }) {
  container.innerHTML = `<details class="everytime-panel"><summary>에브리타임 시간표 가져오기</summary><div class="everytime-content"><p>에브리타임 모바일 앱에서 시간표 탭을 열고, 우측 상단의 톱니바퀴 모양 아이콘을 누른 뒤 ‘링크 공유’ 버튼으로 링크를 복사하세요. 공개 시간표 링크를 아래에 입력해 주세요.</p><p class="helper">가져온 수업을 확인한 뒤 고정 일정에 추가해요. 30분보다 짧은 단위는 겹치는 30분 칸 전체를 제외해요. 시간표를 바꾸면 다시 가져와 주세요.</p><form id="everytime-form"><div class="field"><label for="everytime-url">에브리타임 공유 링크</label><input type="url" id="everytime-url" required maxlength="200" placeholder="https://everytime.kr/@…" aria-describedby="everytime-privacy"></div><button class="button secondary" type="submit">시간표 미리보기</button></form><p id="everytime-privacy" class="privacy-note">에브리타임 로그인 정보는 필요하지 않아요. 가져온 일정 이름은 나에게만 보여요.</p><p class="inline-status" id="everytime-status" role="status"></p><section id="everytime-preview" aria-label="가져올 수업 확인" hidden><h3>추가할 수업을 확인해 주세요</h3><div class="import-actions"><button type="button" class="quiet-button" id="import-select">수업 모두 선택</button><button type="button" class="quiet-button" id="import-clear">선택 해제</button></div><ul class="import-list" id="everytime-list"></ul><button class="button" type="button" id="everytime-save">선택한 수업을 고정 일정에 추가</button></section></div></details>`;
  const form = container.querySelector('form'), preview = container.querySelector('#everytime-preview'), list = container.querySelector('#everytime-list'), message = container.querySelector('#everytime-status'), apply = container.querySelector('#everytime-save');
  let items = [], busy = false;
  const report = (text, error = false) => { message.textContent = text; message.classList.toggle('error', error); };
  const checkboxes = () => [...list.querySelectorAll('input[type="checkbox"]')];
  const update = () => { const count = checkboxes().filter(box => box.checked).length; apply.disabled = busy || count === 0; apply.textContent = `선택한 수업 ${count}개를 고정 일정에 추가`; };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; form.querySelector('button').disabled = true; preview.hidden = true; report('시간표를 가져오고 있어요…');
    try {
      const data = await request(container.querySelector('#everytime-url').value.trim());
      items = data.items; list.replaceChildren();
      items.forEach((item, index) => {
        const li = document.createElement('li'), label = document.createElement('label'), box = document.createElement('input'), content = document.createElement('span'), name = document.createElement('strong'), time = document.createElement('span');
        box.type = 'checkbox'; box.checked = true; box.value = String(index); box.onchange = update;
        name.textContent = item.name; time.textContent = `매주 ${days[item.weekday]}요일 / ${timeLabel(item.start)} ~ ${timeLabel(item.end)}`;
        content.append(name, time); label.append(box, content); li.append(label); list.append(li);
      });
      preview.hidden = false;
      report(`수업 시간 ${items.length}개를 가져왔어요.${data.skipped ? ` 시간이 없는 수업 ${data.skipped}개는 제외했어요.` : ''} 저장할 수업을 선택해 주세요.`);
    } catch (error) { report(error.message, true); }
    finally { busy = false; form.querySelector('button').disabled = false; update(); }
  };
  container.querySelector('#import-select').onclick = () => { if (busy) return; checkboxes().forEach(box => { box.checked = true; }); update(); };
  container.querySelector('#import-clear').onclick = () => { if (busy) return; checkboxes().forEach(box => { box.checked = false; }); update(); };
  apply.onclick = async () => {
    if (busy) return;
    busy = true; update();
    try {
      const merged = mergeImportedFixed(current(), checkboxes().filter(box => box.checked).map(box => items[Number(box.value)]));
      if (!merged.added) { report('선택한 수업이 모두 고정 일정에 등록되어 있어요.'); return; }
      await save(merged.items); onSaved(); preview.hidden = true;
      report(`고정 일정 ${merged.added}개를 추가했어요. 모든 약속에서 자동으로 제외돼요. 기존 일정은 유지했어요.`);
    } catch (error) { report(error.message, true); }
    finally { busy = false; update(); }
  };
}
