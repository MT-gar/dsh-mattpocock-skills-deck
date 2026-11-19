// 「下一步建议」的按钮组在输入 dock 中参与正常布局，给目标、任务栏留下真实空间。
// 只有悬停说明使用页面浮层，避免被会话滚动区域裁剪；按钮不再测量输入框或轮询屏幕位置。
// 本文件由构建拼入客户端闭包；跨叶子调用由 declare 声明，不在运行时重复导入。
declare const React: any;
declare const PortalOverlay: any;
declare function inject(...args: any[]): any;
declare const SUGGEST_TOOLTIP_Z: any;
declare const SUGGEST_APPEARANCE: any;
declare function createSuggestEngine(...args: any[]): any;
declare function suggestPopShiftOf(rect: any, viewWidth: any, viewHeight: any, margin: any): any;

const SUGGEST_VIEW_MAX_ITEMS = 4

/** 过滤缺少提示词的条目；旧事件没有简介或说明时仍然可以使用。 */
export const suggestViewItemsOf = function (items: any) {
  const out: any[] = []
  if (!Array.isArray(items)) return out
  for (const item of items) {
    if (out.length >= SUGGEST_VIEW_MAX_ITEMS) break
    if (!item || typeof item !== 'object' || typeof item.prompt !== 'string' || !item.prompt) continue
    out.push({
      prompt: item.prompt,
      intro: typeof item.intro === 'string' ? item.intro : '',
      reason: typeof item.reason === 'string' ? item.reason : '',
      gain: typeof item.gain === 'string' ? item.gain : '',
      cost: typeof item.cost === 'string' ? item.cost : '',
      priority: typeof item.priority === 'number' && Number.isFinite(item.priority) ? item.priority : null,
    })
  }
  return out
}

/** 显示前把说明卡片夹回视口；计算仍复用既有的纯函数。 */
const suggestClampPopToViewport = function (pop: any) {
  if (!pop || !pop.style || typeof pop.getBoundingClientRect !== 'function') return
  pop.style.setProperty('--dsws-sugg-pop-shift', '0px')
  pop.style.setProperty('--dsws-sugg-pop-shift-y', '0px')
  const shift = suggestPopShiftOf(pop.getBoundingClientRect(), window.innerWidth, window.innerHeight, SUGGEST_APPEARANCE.popViewportMarginPx)
  if (shift.x) pop.style.setProperty('--dsws-sugg-pop-shift', shift.x + 'px')
  if (shift.y) pop.style.setProperty('--dsws-sugg-pop-shift-y', shift.y + 'px')
}

/** 说明按推荐分、理由、优点、缺点显示，旧事件缺少的字段不补空行。 */
export const popBodyOf = function (item: any, index: number) {
  const rows: any[] = []
  function pushRow(key: string, labelKey: string, text: any) {
    if (typeof text !== 'string' || !text) return
    rows.push(React.createElement('div', { key: 'suggest-row-' + index + '-' + key, className: 'dsws-sugg-pop-row' },
      React.createElement('span', { className: 'dsws-sugg-pop-label' }, tr(labelKey)),
      React.createElement('span', { className: 'dsws-sugg-pop-value' }, text)))
  }
  const priority = item && typeof item.priority === 'number' && Number.isFinite(item.priority) ? item.priority : null
  pushRow('score', 'suggest.label.score', priority === null ? '' : String(priority))
  pushRow('reason', 'suggest.label.reason', item && item.reason)
  pushRow('gain', 'suggest.label.gain', item && item.gain)
  pushRow('cost', 'suggest.label.cost', item && item.cost)
  return rows
}

/** 仅说明卡片 portal 到页面；离开按钮、滚动或调整窗口后关闭，不留下游离卡片。 */
const SuggestTooltip = function (props: any) {
  const ref = React.useRef(null)
  const rect = props.anchor.getBoundingClientRect()
  const layoutEffect = React.useLayoutEffect || React.useEffect
  layoutEffect(function () {
    try { suggestClampPopToViewport(ref.current) } catch (eClamp) {}
    const close = props.onClose
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return function () {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [props.anchor, props.onClose])
  return PortalOverlay({
    ref: ref, id: props.id, className: 'dsws-sugg-pop dsws-sugg-pop-open', role: 'tooltip',
    style: { position: 'fixed', left: rect.left + rect.width / 2, bottom: window.innerHeight - rect.top + SUGGEST_APPEARANCE.popGapPx, zIndex: SUGGEST_TOOLTIP_Z },
  }, popBodyOf(props.item, props.index))
}

/** 点选只填入输入框；切页面仅隐藏，显式关闭和点选才作废这组建议。 */
export const SuggestBubble = function (props: any) {
  const safeProps = props && typeof props === 'object' ? props : {}
  const group = safeProps.group
  const items = suggestViewItemsOf(group && group.items)
  const groupKey = group && group.id !== undefined && group.id !== null ? String(group.id) : '0'
  const layerRef = React.useRef(null)
  const engineRef = React.useRef(null)
  const leavingRef = React.useRef(false)
  const committedRef = React.useRef(false)
  const [popup, setPopup] = React.useState(null as any)
  const gap = Number(SUGGEST_APPEARANCE.pillGapPx) || 0
  const maxWidth = Number(SUGGEST_APPEARANCE.maxWidthPx) || 0
  const singleMax = Number(SUGGEST_APPEARANCE.pillMaxWidthPx) || 0
  const share = items.length ? Math.floor((maxWidth - gap * (items.length - 1)) / items.length) : singleMax
  const pillCapPx = Math.min(singleMax, share > 0 ? share : singleMax)

  React.useEffect(function () {
    leavingRef.current = false
    committedRef.current = false
    setPopup(null)
    let engine: any = null
    try {
      if (items.length && layerRef.current) {
        engine = createSuggestEngine(layerRef.current)
        engine.run()
        engineRef.current = engine
      }
    } catch (eEngine) {}
    return function () {
      if (engineRef.current === engine) engineRef.current = null
      try { if (engine) engine.dispose() } catch (eDispose) {}
    }
  }, [groupKey])

  function commitDismiss() {
    if (committedRef.current) return
    committedRef.current = true
    if (typeof safeProps.onCommitDismiss === 'function') safeProps.onCommitDismiss()
  }
  function dismiss() {
    commitDismiss()
    if (typeof safeProps.onDismiss === 'function') safeProps.onDismiss()
  }
  function playOut(kind: string) {
    if (leavingRef.current) return
    leavingRef.current = true
    commitDismiss()
    setPopup(null)
    let animated = false
    try { animated = engineRef.current ? engineRef.current.playOut(kind, dismiss) : false } catch (ePlay) {}
    if (!animated) dismiss()
  }
  React.useEffect(function () {
    if (!items.length) return undefined
    function onKey(ev: any) { if (ev && ev.key === 'Escape') dismiss() }
    document.addEventListener('keydown', onKey)
    return function () { document.removeEventListener('keydown', onKey) }
  }, [groupKey, items.length])
  function pick(prompt: string) {
    if (leavingRef.current) return
    try { inject(safeProps.st, prompt) } catch (eInject) {}
    playOut('pick')
  }
  function pillNodeOf(item: any, index: number) {
    const popId = 'suggest-pop-' + String(safeProps.sid || '') + '-' + groupKey + '-' + index
    const hasPop = Boolean(item.reason || item.gain || item.cost)
    const button = React.createElement('button', {
      type: 'button', className: 'dsws-sugg-pill', 'data-press': 'button', 'data-log': 'suggest.pill',
      style: { maxWidth: 'min(100%, ' + pillCapPx + 'px)' },
      'aria-label': item.intro ? item.intro + ' ' + item.prompt : item.prompt,
      'aria-describedby': hasPop && popup && popup.index === index ? popId : undefined,
      onClick: function (ev: any) { ev.stopPropagation(); pick(item.prompt) },
      onKeyDown: function (ev: any) {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar' || ev.key === 'Space') {
          ev.preventDefault(); ev.stopPropagation(); pick(item.prompt)
        }
      },
    }, item.intro ? React.createElement('span', { className: 'dsws-sugg-intro' }, item.intro) : item.prompt)
    function show(ev: any) {
      if (hasPop && !leavingRef.current) setPopup({ anchor: ev.currentTarget, item: item, index: index, id: popId })
    }
    function hide() { setPopup(null) }
    return React.createElement('span', {
      key: 'suggest-wrap-' + index, className: 'dsws-sugg-pill-wrap',
      style: { maxWidth: '100%', minWidth: 0 }, onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide,
    }, button)
  }
  if (!items.length) return null
  return React.createElement(React.Fragment, null,
    React.createElement('div', {
      ref: layerRef, className: 'dsws-sugg-layer', role: 'group', 'aria-label': tr('suggest.group'), 'data-log': 'suggest.group',
      style: { position: 'relative', width: '100%', maxWidth: SUGGEST_APPEARANCE.maxWidthPx + 'px', boxSizing: 'border-box', margin: '0 auto', paddingBottom: SUGGEST_APPEARANCE.gapAboveCapsule, pointerEvents: 'none' },
    }, [
      React.createElement('div', { className: 'dsws-sugg-row', key: 'suggest-row' }, items.map(pillNodeOf)),
      React.createElement('div', { className: 'dsws-sugg-xrow', key: 'suggest-close-row' }, React.createElement('button', {
        type: 'button', className: 'dsws-sugg-close dsws-hov', title: tr('suggest.close'), 'aria-label': tr('suggest.close'),
        'data-press': 'button', 'data-log': 'suggest.close', onClick: function (ev: any) { ev.stopPropagation(); playOut('fade') },
      }, '×')),
      React.createElement('div', { className: 'dsws-sugg-sr', key: 'suggest-sr', role: 'status', 'aria-live': 'polite' }, tr('suggest.live', { n: items.length })),
    ]),
    popup ? React.createElement(SuggestTooltip, { ...popup, key: popup.id, onClose: function () { setPopup(null) } }) : null)
}
