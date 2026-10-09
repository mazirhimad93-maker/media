// Keep mobile navigation and the keyboard viewport independent of message delivery.
const mobile = window.matchMedia('(max-width: 760px)');
const $ = id => document.getElementById(id);
let syncLayout = () => {};
let savedScroll = 0;

export const isMobileInbox = () => mobile.matches;

export function openMobileThread(id) {
  if (mobile.matches && !history.state?.alchemicChat) {
    history.pushState({ ...history.state, alchemicChat: String(id) }, '', location.href);
  } else if (mobile.matches) {
    history.replaceState({ ...history.state, alchemicChat: String(id) }, '', location.href);
  }
  syncLayout();
}

export function closeMobileThread() {
  $('conversation-reply-body').blur();
  document.querySelector('.inbox-layout').classList.remove('show-thread');
  $('composer-more-button').setAttribute('aria-expanded', 'false');
  $('composer-emoji-picker').hidden = true;
  syncLayout();
  if (mobile.matches && history.state?.alchemicChat) history.back();
}

export function initMobileInbox(onBreakpointChange) {
  const layout = document.querySelector('.inbox-layout');
  const conversation = document.querySelector('.inbox-conversation');
  const more = $('composer-more-button');
  const textarea = $('conversation-reply-body');
  const messages = $('conversation-messages');
  let wasChat = false;
  let viewportFrame = 0;

  const updateViewport = () => {
    cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      conversation.style.setProperty('--inbox-viewport-height', `${viewport?.height || window.innerHeight}px`);
      conversation.style.setProperty('--inbox-viewport-top', `${viewport?.offsetTop || 0}px`);
    });
  };

  syncLayout = () => {
    const inInbox = $('view-inbox').classList.contains('active') && !$('app-shell').hidden;
    const chat = mobile.matches && inInbox && !$('inbox-messages-panel').hidden && layout.classList.contains('show-thread');
    document.body.classList.toggle('mobile-inbox', mobile.matches && inInbox);
    document.body.classList.toggle('mobile-inbox-chat', chat);
    if (chat && !wasChat) {
      savedScroll = window.scrollY;
      updateViewport();
    } else if (!chat && wasChat) {
      more.setAttribute('aria-expanded', 'false');
      $('composer-emoji-picker').hidden = true;
      window.scrollTo(0, savedScroll);
    }
    wasChat = chat;
  };

  const observer = new MutationObserver(syncLayout);
  observer.observe($('view-inbox'), { attributes: true, attributeFilter: ['class'] });
  observer.observe($('app-shell'), { attributes: true, attributeFilter: ['hidden'] });
  observer.observe($('inbox-messages-panel'), { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(layout, { attributes: true, attributeFilter: ['class'] });
  mobile.addEventListener('change', () => { syncLayout(); onBreakpointChange(); });
  window.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  window.addEventListener('popstate', () => {
    const id = window.__alchemic?.state.inbox.selected?.id;
    const restore = history.state?.alchemicChat === String(id);
    layout.classList.toggle('show-thread', restore);
    if (!restore) textarea.blur();
    syncLayout();
  });

  more.addEventListener('click', () => {
    const expanded = more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(expanded));
    if (!expanded) $('composer-emoji-picker').hidden = true;
  });
  textarea.addEventListener('focus', () => {
    if (!mobile.matches) return;
    more.setAttribute('aria-expanded', 'false');
    $('composer-emoji-picker').hidden = true;
    messages.scrollTop = messages.scrollHeight;
    updateViewport();
  });
  // Newly wrapped messages remain pinned when the keyboard changes the available height.
  let previousHeight = messages.clientHeight;
  new ResizeObserver(() => {
    const nearBottom = messages.scrollHeight - messages.scrollTop - previousHeight < 90;
    previousHeight = messages.clientHeight;
    if (mobile.matches && wasChat && (nearBottom || document.activeElement === textarea)) messages.scrollTop = messages.scrollHeight;
  }).observe(messages);
  syncLayout();
}
