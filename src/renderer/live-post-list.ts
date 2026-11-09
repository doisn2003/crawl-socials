/** Hold a stable page while someone is reading. Keep only the latest pending page. */
export function bindLivePostList<T>(list: HTMLElement, jump: HTMLButtonElement, createCard: (item: T) => HTMLElement) {
  let view = '', shown = '', latest = '', items: readonly T[] = [];

  function reading() {
    const focused = document.activeElement;
    return list.scrollTop > 2 || focused === jump || (focused !== list && list.contains(focused));
  }
  function render() {
    if (shown !== latest) {
      shown = latest;
      if (items.length) list.replaceChildren(...items.map(createCard));
      else {
        const empty = document.createElement('p');
        empty.className = 'helper';
        empty.textContent = 'Chưa có kết quả trong nhóm này.';
        list.replaceChildren(empty);
      }
    }
  }
  function sync() {
    if (!reading()) render();
    jump.hidden = document.activeElement !== jump && shown === latest && (!items.length || list.scrollTop <= 2);
  }
  list.addEventListener('scroll', sync, { passive: true });
  list.addEventListener('focusout', () => queueMicrotask(sync));
  jump.addEventListener('focusout', () => queueMicrotask(sync));
  jump.addEventListener('click', () => {
    list.focus({ preventScroll: true });
    render();
    list.scrollTop = 0;
    sync();
  });

  return (nextView: string, nextItems: readonly T[]) => {
    items = nextItems;
    latest = JSON.stringify(items);
    if (view !== nextView) {
      view = nextView;
      render();
      list.scrollTop = 0;
    }
    sync();
  };
}
