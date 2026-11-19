// 主按钮参与输入 dock 的正常布局，仅聊天页显示；切页、关闭、动画中断不得互相混淆。
// 本门禁验证组件和接线；真实浏览器的几何与层级由单独的验收记录提供证据。
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { JSDOM } = require('jsdom')
const React = require('react')
const { printGateResult } = require('./lib/gate-result.ts')
const ROOT = path.resolve(__dirname, '..')
const imp = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href)
const failures: string[] = []
let total = 0
function check(ok: unknown, label: string) { total++; if (!ok) failures.push(label) }
async function main() {
  const dom = new JSDOM('<!doctype html><html><body><main id="dock"></main></body></html>', { url: 'http://localhost/' })
  const win = dom.window
  Object.assign(globalThis, { window: win, document: win.document, localStorage: win.localStorage, React, IS_REACT_ACT_ENVIRONMENT: true })
  const ReactDOM = require('react-dom')
  const { createRoot } = require('react-dom/client')
  const { act } = React
  globalThis.tr = (key: string) => key
  let deckClosed = false
  globalThis.isDeckCapsuleFolded = () => deckClosed
  globalThis.deckSuggestOf = () => 'on'
  globalThis.isDeckClosed = () => deckClosed
  globalThis.inject = () => {}
  globalThis.PortalOverlay = (props: any, children: any) => ReactDOM.createPortal(React.createElement('div', props, children), document.body)
  const appearance = await imp('src/client/statusbar/suggestAppearance.ts')
  globalThis.SUGGEST_APPEARANCE = appearance.SUGGEST_APPEARANCE
  globalThis.SUGGEST_TOOLTIP_Z = appearance.SUGGEST_TOOLTIP_Z
  globalThis.suggestPopShiftOf = (await imp('src/client/statusbar/suggestTimeline.ts')).suggestPopShiftOf
  globalThis.SuggestBubble = (await imp('src/client/statusbar/suggestBubble.ts')).SuggestBubble
  Object.assign(globalThis, await imp('src/client/statusbar/suggestFacts.ts'))
  const stream = await imp('src/client/statusbar/suggestStream.ts')
  Object.assign(globalThis, { suggestGroupRecall: stream.suggestGroupRecall, suggestGroupForget: stream.suggestGroupForget, suggestClosedRemember: stream.suggestClosedRemember, SuggestStreamMount: stream.SuggestStreamMount })
  const gate = await imp('src/client/statusbar/suggestGate.ts')
  globalThis.useSuggestInterruptedDismiss = gate.useSuggestInterruptedDismiss
  globalThis.suggestCommitDismiss = gate.suggestCommitDismiss
  globalThis.useSuggestBubbleGate = gate.useSuggestBubbleGate
  const st = { cwd: 'D:/demo', injector() {} }
  let subscriptions = 0
  globalThis.DswsCtx = React.createContext({ storeSvc: { useStore: () => st }, ctx: { get: () => ({ binding: () => ({ eventSource: {
    getSnapshot: () => ({ entries: [] }), subscribe: () => { subscriptions++; return () => { subscriptions-- } },
  } }) }) } })
  const items = [{ intro: '检查修改', prompt: '检查本次修改' }, { intro: '验收效果', prompt: '验收按钮显示' }]
  function remember(sid: string, id: number) { stream.suggestGroupRemember(sid, { id, callId: 'call-' + sid + '-' + id, items }) }
  remember('layout-session', 1)
  const host = document.getElementById('dock')!
  const root = createRoot(host)
  async function render(view: string | null, sid = 'layout-session', views = ['chat', 'trajectory', 'context', 'stats', 'custom-view']) {
    await act(async () => {
      root.render(React.createElement(React.Fragment, null,
        React.createElement(gate.StatusDock, { key: sid, sessionId: sid, useStore: (select: any) => select({ view }), useSuggestViews: (select: any) => select(views) }),
        React.createElement('div', { 'data-test-statusbar': true })))
    })
  }
  try {
    await render('chat')
    const layer = host.querySelector('.dsws-sugg-layer') as HTMLElement | null
    check(layer !== null, '聊天页主按钮属于输入 dock，不挂到 body 浮层')
    check(layer?.style.position === 'relative', '主按钮参与正常布局，为目标、任务栏留空间')
    check(layer?.style.width === '100%', '按钮组宽度受会话列限制')
    check(host.querySelector('.dsws-sugg-space') === null, '使用按钮本身的高度，不依赖尺寸替身或空占位')
    check(layer?.parentElement?.nextElementSibling?.hasAttribute('data-test-statusbar'), '建议区位于状态栏之外，不被胶囊裁剪')
    for (const view of ['trajectory', 'context', 'stats', 'custom-view']) {
      await render(view)
      check(host.querySelector('.dsws-sugg-layer') === null, view + ' 不显示建议')
      check(stream.suggestGroupRecall('layout-session') !== null, view + ' 只隐藏，不作废建议')
    }
    await render('chat')
    check(host.querySelectorAll('.dsws-sugg-pill').length === 2, '回到聊天恢复同一组建议')
    check(subscriptions === 1, '切页不重复建立事件订阅')
    await render('trajectory', 'layout-session', ['chat', 'context'])
    check(host.querySelector('.dsws-sugg-layer') !== null, '轨迹页不可用后跟随宿主回退到聊天')
    await render('removed-plugin-view', 'layout-session', ['chat'])
    check(host.querySelector('.dsws-sugg-layer') !== null, '第三方页面移除后回退到聊天')
    await render(null, 'layout-session', ['trajectory'])
    check(host.querySelector('.dsws-sugg-layer') === null, '没有聊天且没有有效选项时不显示建议')
    await render('chat', 'other-session')
    check(host.querySelector('.dsws-sugg-layer') === null, '宿主会话重挂不会带出另一会话的建议')
    await render('chat')
    // 动画不立即调用 done：模拟用户在视觉退场结束前切页。
    let finish: (() => void) | null = null
    globalThis.createSuggestEngine = () => ({ run() {}, dispose() { finish = null }, playOut(_kind: string, done: () => void) { finish = done; return true } })
    for (const action of ['close', 'pick']) {
      const sid = 'animated-' + action
      remember(sid, 1)
      await render('chat', sid)
      await act(async () => { (host.querySelector(action === 'close' ? '.dsws-sugg-close' : '.dsws-sugg-pill') as HTMLButtonElement).click() })
      check(finish !== null, action + ' 保留视觉退场动画')
      check(stream.suggestGroupRecall(sid) === null, action + ' 在动作当刻写入关闭结果')
      await render('trajectory', sid)
      await render('chat', sid)
      check(host.querySelector('.dsws-sugg-layer') === null, action + ' 动画中切页后不会复活')
    }
    const toggledSid = 'same-mount-deck'
    remember(toggledSid, 1)
    await render('chat', toggledSid)
    check(host.querySelector('.dsws-sugg-layer') !== null, '同一挂载关闭前显示建议')
    deckClosed = true
    await render('chat', toggledSid)
    check(host.querySelector('.dsws-sugg-layer') === null, '不卸载组件也能隐藏关闭的 Deck 建议')
    const closedTable = JSON.parse(localStorage.getItem('dsws.suggestClosed') || '{}')
    check(stream.suggestGroupRecall(toggledSid) === null && closedTable[toggledSid]?.callId === 'call-' + toggledSid + '-1', '不卸载组件也会清缓存并保存关闭标记')
    deckClosed = false
    await render('chat', toggledSid)
    check(host.querySelector('.dsws-sugg-layer') === null, '同一挂载重开 Deck 不会恢复作废的建议')
  } finally {
    await act(async () => { root.unmount() })
    check(subscriptions === 0, '卸载释放事件订阅')
    dom.window.close()
  }
  for (const failure of failures) console.error('FAIL ' + failure)
  printGateResult('verify-suggest-chat-layout', total, failures.length ? 1 : 0)
  assert.equal(failures.length, 0, failures.join('\n'))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
