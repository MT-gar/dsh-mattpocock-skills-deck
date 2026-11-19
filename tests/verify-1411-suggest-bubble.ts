// tests/verify-1411-suggest-bubble.ts —— 门禁：状态胶囊上方的下一步建议气泡（#1411）
//
// 契约（票面 #1411 验收①~⑤、⑦、⑨）：
//   - 主按钮组参与输入区正常布局，宽度受所在列与 720 像素上限共同约束，为目标和任务栏留下真实空间；
//   - 只有说明卡片通过 PortalOverlay 挂到 body，显示时才创建，固定在按钮上方并夹回视口；
//     离开按钮、失焦、滚动、resize、换组或卸载时清掉说明卡片与监听；
//   - 选项 2~4 颗，点一条走既有 inject（把文本填进输入框、不发送），点完/关闭整组消失；
//   - 第二组覆盖第一组；真按钮可聚焦，回车/空格填入，Esc 关整组；理由对读屏可读（aria-label）；
//   - 窄栏不溢出（层宽收在视口内、选项行可换行、单颗有上限）；数据不合法不崩、不渲染半成品；
//   - 源码守卫：外观旋钮集中一处（层级常量值不变、样式不写死尺寸）、界面不越权碰会话服务、
//     三片叶子在入口与构建清单里登记齐全。
//
// 跑法：node --import ./scripts/ts-hook.mts tests/verify-1411-suggest-bubble.ts
// 断言数变化时同步 scripts/gate-map.mts 里 COMPLETION_RECORDED_GATES 的 verify-1411-suggest-bubble。
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { printGateResult } = require('./lib/gate-result.ts')
const { JSDOM } = require('jsdom')
const React = require('react')
const ROOT = path.resolve(__dirname, '..')
const imp = function (rel) { return import(pathToFileURL(path.join(ROOT, rel)).href) }

const failures = []
let total = 0
function check(ok, label) {
  total++
  if (!ok) failures.push(label)
}
// 源码守卫只看代码行：整行注释与块注释里的字眼不算（注释里可以提到「sessions」「2147483000」这类名字）。
function codeOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(function (line) { return line.trim().indexOf('//') !== 0 })
    .join('\n')
}

async function main() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://127.0.0.1:59519/',
    runScripts: 'dangerously',
  })
  const win = dom.window
  global.window = win
  global.document = win.document
  try { global.navigator = win.navigator } catch (eNav) {}
  global.Node = win.Node
  global.HTMLElement = win.HTMLElement
  global.getComputedStyle = win.getComputedStyle.bind(win)
  global.requestAnimationFrame = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (cb) { return setTimeout(cb, 0) }
  global.cancelAnimationFrame = win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : function (id) { clearTimeout(id) }
  win.React = React
  global.React = React
  const ReactDOMClient = require('react-dom/client')
  win.ReactDOM = ReactDOMClient
  global.ReactDOM = ReactDOMClient
  global.IS_REACT_ACT_ENVIRONMENT = true
  const act = React.act

  // 词表：与 config/copy/panel.yaml 的 suggest.* 同形；键缺了按键名回退（和真 tr 一致）。
  const dict = {
    'suggest.group': '下一步建议',
    'suggest.close': '关闭（等于一条都不选）',
    'suggest.label.score': '推荐分',
    'suggest.label.reason': '理由',
    'suggest.label.gain': '优点',
    'suggest.label.cost': '缺点',
    'suggest.live': '有 {n} 条下一步建议',
  }
  function trFn(key, params) {
    let text = (dict[key] !== undefined) ? dict[key] : key
    if (params) {
      text = text.replace(/\{(\w+)\}/g, function (m, name) {
        return (params[name] !== undefined) ? String(params[name]) : m
      })
    }
    return text
  }
  global.tr = trFn

  // 跨叶子自由变量：外观常量、三片叶子对内核/相邻叶子的调用，都在这里打桩（真机由构建闭包提供）。
  const appearanceMod = await imp('src/client/statusbar/suggestAppearance.ts')
  global.SUGGEST_Z = appearanceMod.SUGGEST_Z
  global.SUGGEST_TOOLTIP_Z = appearanceMod.SUGGEST_TOOLTIP_Z
  global.SUGGEST_APPEARANCE = appearanceMod.SUGGEST_APPEARANCE
  // #1236：动画时长住在 kernel/motion.ts 的 MOTION 里，样式叶子求值前必须先接上。
  const motionMod = await imp('src/client/kernel/motion.ts')
  global.MOTION = motionMod.MOTION
  const injectCalls = []
  const portalCalls = []
  global.inject = function (st, text) { injectCalls.push({ st: st, text: text }) }
  // 真 Portal 把卡片放到 body，才能发现主组误进浮层、卡片被父容器裁剪及卸载残留。
  const { createPortal } = require('react-dom')
  let tooltipRect: any = null
  global.PortalOverlay = function (props, children) {
    portalCalls.push(props)
    const originalRef = props.ref
    return createPortal(React.createElement('div', { ...props, ref: function (node) {
      if (node && tooltipRect) node.getBoundingClientRect = function () { return tooltipRect }
      if (typeof originalRef === 'function') originalRef(node)
      else if (originalRef) originalRef.current = node
    } }, children), document.body)
  }
  const timelineMod = await imp('src/client/statusbar/suggestTimeline.ts')
  global.suggestPopShiftOf = timelineMod.suggestPopShiftOf
  const stylesMod = await imp('src/client/statusbar/suggestStyles.ts')
  const bubbleMod = await imp('src/client/statusbar/suggestBubble.ts')
  // 正常用例没有布局，执行者返回 false；退场用例另装可控替身，验证薄壳对完成回调的处理。
  const engines: any[] = []
  let animatedExit = false
  global.createSuggestEngine = function (layer) {
    const engine = { layer, disposed: false, exits: [], done: null,
      run: function () { return false },
      playOut: function (kind, done) { engine.exits.push(kind); engine.done = done; return animatedExit },
      dispose: function () { engine.disposed = true },
    }
    engines.push(engine)
    return engine
  }
  function popup() {
    const all = document.querySelectorAll('.dsws-sugg-pop')
    return all.length ? all[all.length - 1] : null
  }

  // ---------- 渲染夹具：真 jsdom + 真 React，只有跨叶子调用是桩 ----------
  async function mount(options) {
    const opts = options || {}
    const host = document.createElement('div')
    document.body.appendChild(host)
    // dock 是正常文档流：建议组、目标、任务与状态栏是相邻项目，建议组不住进会裁剪内容的胶囊。
    const holder = document.createElement('div')
    holder.className = 'suggest-dock-slot'
    host.appendChild(holder)
    const target = document.createElement('div')
    target.className = 'host-target'
    target.textContent = '目标区域'
    host.appendChild(target)
    const task = document.createElement('div')
    task.className = 'host-task'
    task.textContent = '任务区域'
    host.appendChild(task)
    let capsule: any = null
    if (!opts.noCapsule) {
      capsule = document.createElement('div')
      capsule.className = 'dsws-capsule'
      host.appendChild(capsule)
    }
    const st = { injector: function () {} }
    let setGroup = null
    function Host() {
      const state = React.useState(opts.initial ? { id: 1, items: opts.initial } : null)
      setGroup = state[1]
      const group = state[0]
      if (!group) return null
      return React.createElement(bubbleMod.SuggestBubble, {
        st: st,
        sid: 'sid-1',
        group: group,
        onCommitDismiss: opts.onCommitDismiss,
        onDismiss: function () { setGroup(null) },
      })
    }
    const root = ReactDOMClient.createRoot(holder)
    portalCalls.length = 0
    await act(async function () {
      root.render(React.createElement(Host))
      await new Promise(function (resolve) { setTimeout(resolve, 0) })
    })
    if (opts.anchorRect) {
      const anchor = holder.querySelector('.dsws-sugg-pill')
      const wrapper = anchor && anchor.parentNode
      if (anchor) anchor.getBoundingClientRect = function () { return opts.anchorRect }
      if (wrapper && wrapper.getBoundingClientRect) wrapper.getBoundingClientRect = function () { return opts.anchorRect }
    }
    return {
      host: host,
      capsule: capsule,
      holder: holder,
      st: st,
      async setItems(items, id) {
        await act(async function () {
          setGroup({ id: id || 2, items: items })
          await new Promise(function (resolve) { setTimeout(resolve, 0) })
        })
      },
      pills: function () { return Array.prototype.slice.call(holder.querySelectorAll('.dsws-sugg-pill')) },
      layer: function () { return holder.querySelector('.dsws-sugg-layer') },
      tooltip: function () {
        const described = holder.querySelector('[aria-describedby]')
        const id = described && described.getAttribute('aria-describedby')
        return id ? document.getElementById(id) : popup()
      },
      closeBtn: function () { return holder.querySelector('.dsws-sugg-close') },
      sr: function () { return holder.querySelector('.dsws-sugg-sr') },
      async fire(node, type, event) {
        await act(async function () {
          node.dispatchEvent(event)
          await new Promise(function (resolve) { setTimeout(resolve, 0) })
        })
      },
      async click(node) {
        await act(async function () {
          node.click()
          await new Promise(function (resolve) { setTimeout(resolve, 0) })
        })
      },
      async unmount() {
        await act(async function () { root.unmount() })
        if (host.parentNode) host.parentNode.removeChild(host)
      },
    }
  }
  function keyEvent(key) {
    return new win.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true })
  }

  // ---------- 1. 基本形状：两颗选项、层属性、层级、锚点、读屏 ----------
  {
    injectCalls.length = 0
    const m = await mount({
      initial: [
        { intro: '接着做', prompt: '/next', reason: '因为还有一张票没关' },
        { intro: '收尾', prompt: '继续收尾', reason: '' },
      ],
      anchorRect: { left: 100, top: 300, width: 120, height: 30 },

    })
    check(m.pills().length === 2, '基本：显示 2 颗选项')
    // #1451 后续：选项框上只印简介，提示词不进按钮（点选时才填进输入框）；两颗时每颗最大宽度均分整组（(720-6)/2=357）。
    check(m.pills()[0].textContent === '接着做', '基本：选项框上只显示简介')
    check(m.pills()[0].querySelector('.dsws-sugg-cmd') === null && m.pills()[0].textContent.indexOf('/next') < 0, '基本：提示词不进按钮（点选时才填）')
    check(m.pills()[0].style.maxWidth === 'min(100%, 357px)' && m.pills()[1].style.maxWidth === 'min(100%, 357px)', '基本：两颗时每颗最大宽度均分整组并受所在列约束（(720-6)/2=357）')
    check(m.pills()[0].parentNode !== null && m.pills()[0].parentNode.className.indexOf('dsws-sugg-pill-wrap') >= 0, '基本：按钮保留包裹节点，便于悬停与键盘焦点显示说明')
    const layer = m.layer()
    check(layer !== null, '基本：气泡层已渲染')
    check(layer.getAttribute('role') === 'group', '基本：层 role=group')
    check(layer.getAttribute('aria-label') === '下一步建议', '基本：层 aria-label 走词表')
    check(layer.getAttribute('data-log') === 'suggest.group', '基本：层挂 data-log 便于查日志')
    check(layer.style.position === 'relative', '基本：主组使用 relative 定位并留在正常文档流')
    check(layer.style.width === '100%' && layer.style.maxWidth === '720px' && layer.style.boxSizing === 'border-box', '基本：主组占所在列宽度且最大宽度为 720 像素')
    check(layer.style.margin === '0px auto' || layer.style.margin === '0 auto', '基本：主组在受限宽度的列中水平居中')
    check(layer.style.paddingBottom === '9px', '基本：主组在文档流里为后续输入区控件留下间距')
    check(layer.style.pointerEvents === 'none', '基本：层本身不吃鼠标事件（只有子控件可点）')
    check(layer.style.left === '' && layer.style.bottom === '' && layer.style.zIndex === '', '基本：主组没有固定坐标或浮层层级，不覆盖其它输入区控件')
    check(m.pills()[0].getAttribute('aria-label') === '接着做 /next', '基本：选项 aria-label 只念「简介 提示词」，理由交给浮层（读屏走 aria-describedby）')
    check(m.holder.querySelector('.dsws-sugg-pop') === null && portalCalls.length === 0, '基本：未悬停时说明卡片未挂载，主按钮组没有进入页面浮层')
    check(m.pills()[0].getAttribute('aria-describedby') === null, '基本：说明卡片未显示时按钮没有无效的 aria-describedby')
    check(m.pills()[1].getAttribute('aria-label') === '收尾 继续收尾', '基本：没理由的选项 aria-label 念「简介 提示词」，不念理由')
    check(m.sr() !== null && m.sr().getAttribute('role') === 'status' && m.sr().getAttribute('aria-live') === 'polite', '基本：读屏播报节点 role=status aria-live=polite')
    check(m.sr().textContent === '有 2 条下一步建议', '基本：读屏播报条数')
    check(m.closeBtn() !== null && m.closeBtn().getAttribute('type') === 'button', '基本：关闭是真按钮')
    check(m.closeBtn().getAttribute('aria-label') === '关闭（等于一条都不选）', '基本：关闭按钮 aria-label 说明含义')
    check(portalCalls.length === 0, '基本：没有显示说明卡片时不调用 PortalOverlay')
    tooltipRect = { left: 900, right: 1060, top: -20, width: 160, height: 80 }
    await m.fire(m.pills()[0], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    const shownTip = m.tooltip()
    check(shownTip !== null && shownTip.parentNode === document.body, '说明：鼠标进入有说明的按钮时才把卡片 portal 到页面')
    check(shownTip !== null && shownTip.getAttribute('role') === 'tooltip' && shownTip.textContent === '理由因为还有一张票没关', '说明：独立卡片包含理由并保留 tooltip 语义')
    check(m.pills()[0].getAttribute('aria-describedby') === shownTip.getAttribute('id'), '说明：卡片显示时按钮用 aria-describedby 指向它')
    check(shownTip.style.position === 'fixed' && shownTip.style.zIndex === String(appearanceMod.SUGGEST_TOOLTIP_Z), '说明：只有 tooltip 使用固定定位及高于 composer 的专用层级')
    check(shownTip.style.left === '160px' && shownTip.style.bottom === '474px', '说明：tooltip 固定坐标由按钮中心与按钮顶边计算，不跟随鼠标（实测 ' + shownTip.style.left + ' / ' + shownTip.style.bottom + '）')
    check(shownTip.parentNode === document.body && m.holder.querySelector('.dsws-sugg-pop') === null, '说明：tooltip 独立 portal，不占主组正常流空间')
    check(shownTip.style.getPropertyValue('--dsws-sugg-pop-shift') === '-52px' && shownTip.style.getPropertyValue('--dsws-sugg-pop-shift-y') === '36px', '说明：测量显示卡片后分别向左、向下夹回视口边距')
    await m.fire(m.pills()[0], 'mouseout', new win.MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body }))
    check(m.tooltip() === null && m.pills()[0].getAttribute('aria-describedby') === null, '说明：鼠标离开按钮时卸载卡片并清除无效关联')
    await m.fire(m.pills()[0], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    await act(async function () { win.dispatchEvent(new win.Event('scroll')); await new Promise(function (resolve) { setTimeout(resolve, 0) }) })
    check(m.tooltip() === null, '说明：页面滚动时关闭已显示的卡片')
    await m.fire(m.pills()[0], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    await act(async function () { win.dispatchEvent(new win.Event('resize')); await new Promise(function (resolve) { setTimeout(resolve, 0) }) })
    check(m.tooltip() === null, '说明：窗口尺寸改变时关闭已显示的卡片')
    await m.fire(m.pills()[0], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    check(m.tooltip() !== null, '说明：卸载清理用例先确认卡片已挂载')
    await m.unmount()
    check(popup() === null, '说明：组件卸载后 portal 卡片已移除')
    tooltipRect = null

    // 三条、四条时也要排得进一行：宽度按条数均分，条数越多每颗越窄（#1451）。
    const m3 = await mount({
      initial: [
        { intro: '一', prompt: '/one', reason: '' },
        { intro: '二', prompt: '/two', reason: '' },
        { intro: '三', prompt: '/three', reason: '' },
      ],
    })
    check(m3.pills().length === 3 && m3.pills().every(function (p) { return p.style.maxWidth === 'min(100%, 236px)' }),
      '基本：三条时每颗最大宽度均分整组并受所在列约束（(720-12)/3=236，三条排得进一行）')
    await m3.unmount()
    const m4 = await mount({
      initial: [
        { intro: '一', prompt: '/one', reason: '' },
        { intro: '二', prompt: '/two', reason: '' },
        { intro: '三', prompt: '/three', reason: '' },
        { intro: '四', prompt: '/four', reason: '' },
      ],
    })
    check(m4.pills().length === 4 && m4.pills().every(function (p) { return p.style.maxWidth === 'min(100%, 175px)' }),
      '基本：四条时每颗最大宽度均分整组并受所在列约束（(720-18)/4=175）')
    await m4.unmount()
  }

  // ---------- 1.5 正常流：主组与目标、任务区域并列占位，不依赖输入框锚点 ----------
  {
    const m = await mount({ initial: [{ intro: '先处理目标', prompt: '/target', reason: '说明' }] })
    const layer = m.layer()
    const target = m.host.querySelector('.host-target')
    const task = m.host.querySelector('.host-task')
    check(layer !== null && layer.parentNode === m.holder, '正常流：主组直接位于 dock 项目中，不挂到 body 浮层')
    check(m.holder.nextElementSibling === target && target.nextElementSibling === task, '正常流：建议 dock、目标与任务按顺序相邻排列，不由主组覆盖')
    check(layer !== null && layer.style.position === 'relative' && layer.style.width === '100%' && layer.style.maxWidth === '720px', '正常流：主组用相对定位并占所在列宽度，最大不超过 720 像素')
    check(layer !== null && layer.style.position !== 'fixed' && layer.style.position !== 'absolute', '正常流：主组不是脱离文档流的覆盖层')
    check(layer !== null && layer.parentNode !== document.body && layer.parentNode === m.holder, '正常流：主按钮组不直接挂到 body 的浮层容器')
    await m.unmount()
  }
  // ---------- 1.7 浮层四行：推荐分 / 理由 / 优点 / 缺点，缺格跳过 ----------
  {
    const rowsOf = function (pop) { return Array.prototype.slice.call(pop.querySelectorAll('.dsws-sugg-pop-row')) }
    const labelsOf = function (pop) {
      return rowsOf(pop).map(function (row) { return row.querySelector('.dsws-sugg-pop-label').textContent })
    }
    const valuesOf = function (pop) {
      return rowsOf(pop).map(function (row) { return row.querySelector('.dsws-sugg-pop-value').textContent })
    }
    const mScore = await mount({
      initial: [
        { intro: '先做', prompt: '/a', reason: '卡在后面', gain: '能马上解阻塞', cost: '要多花十分钟', priority: 9.5 },
        { intro: '后做', prompt: '/b', reason: '顺手做', gain: '改动小', cost: '收益也小', priority: 3 },
      ],
    })
    await mScore.fire(mScore.pills()[0], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    const firstPop = mScore.tooltip()
    check(firstPop !== null && mScore.holder.querySelectorAll('.dsws-sugg-pop').length === 0, '四行：悬停第一颗时只有一张说明卡片，且卡片不留在主组容器内')
    check(rowsOf(firstPop).length === 4, '四行：完整条目给出推荐分、理由、优点、缺点四行')
    check(labelsOf(firstPop).join('|') === '推荐分|理由|优点|缺点', '四行：行序固定为推荐分、理由、优点、缺点')
    check(valuesOf(firstPop).join('|') === '9.5|卡在后面|能马上解阻塞|要多花十分钟', '四行：每行印对应正文（分数取模型原值）')
    await mScore.fire(mScore.pills()[1], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    const secondPop = mScore.tooltip()
    check(rowsOf(secondPop).length === 4 && valuesOf(secondPop).join('|') === '3|顺手做|改动小|收益也小', '四行：第二颗悬停时单独呈现它的四行内容，分数 3 原样印出')
    const mZero = await mount({
      initial: [
        { intro: '最后', prompt: '/a', reason: 'r', gain: 'g', cost: 'c', priority: 0 },
        { intro: '其次', prompt: '/b', reason: 'r', gain: 'g', cost: 'c', priority: 6 },
      ],
    })
    await mZero.fire(mZero.pills()[0], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    const zeroRows = rowsOf(mZero.tooltip())
    check(zeroRows.length === 4 && zeroRows[0].querySelector('.dsws-sugg-pop-value').textContent === '0', '四行：0 分也印出来（0 是「最后再做」，不是没打分）')
    await mZero.unmount()
    // 旧事件（改四行之前存下的条目）没有 gain/cost/priority：能印几行印几行，不补空行。
    const mLegacy = await mount({ initial: [{ intro: '旧', prompt: '/old', reason: '旧理由' }] })
    await mLegacy.fire(mLegacy.pills()[0], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    const legacyPop = mLegacy.tooltip()
    check(legacyPop !== null && rowsOf(legacyPop).length === 1 && labelsOf(legacyPop).join('|') === '理由', '四行：旧事件缺优点、缺点与推荐分时只印有的一行，不补空行')
    await mLegacy.unmount()
    await mScore.unmount()
  }

  // ---------- 2. 点一条：走既有 inject、不发送、整组消失 ----------
  {
    injectCalls.length = 0
    let commitCalls = 0
    const m = await mount({ initial: [{ prompt: '再跑一遍验证', reason: '上次没跑完' }], onCommitDismiss: function () { commitCalls++ } })
    // 薄壳传入的提交回调在真实挂载组件中负责写关闭标记；这里直接检查它是幂等动作。
    // 夹具不伪造缓存层，只统计用户一次点选产生的一次 onCommitDismiss 入口。
    await m.click(m.pills()[0])
    check(commitCalls === 1, '点选：关闭标记提交回调只调用一次（动画与立即收起不会重复记账）')
    check(injectCalls.length === 1, '点选：调用既有 inject 恰好一次')
    check(injectCalls.length === 1 && injectCalls[0].text === '再跑一遍验证', '点选：把提示词原样交给 inject（补尾换行由 inject 负责）')
    check(injectCalls.length === 1 && injectCalls[0].st === m.st, '点选：交给同一份会话 store（不另造注入通路）')
    check(m.layer() === null && m.pills().length === 0, '点选：随后整组消失，不留半成品')
    await m.unmount()
  }

  // ---------- 3. 关闭按钮：一条不选，不注入 ----------
  {
    injectCalls.length = 0
    const m = await mount({ initial: [{ prompt: '随便一条', reason: '' }] })
    await m.click(m.closeBtn())
    check(injectCalls.length === 0, '关闭：不调用 inject（等于一条都不选）')
    check(m.layer() === null && m.pills().length === 0, '关闭：整组消失')
    await m.unmount()
  }

  // ---------- 4. 键盘：回车与空格填入；都不触发浏览器默认激活 ----------
  {
    injectCalls.length = 0
    const m = await mount({ initial: [{ prompt: '回车填入', reason: '' }] })
    const enterEvent = keyEvent('Enter')
    await m.fire(m.pills()[0], 'keydown', enterEvent)
    check(injectCalls.length === 1 && injectCalls[0].text === '回车填入', '键盘：回车把提示词填入')
    check(enterEvent.defaultPrevented === true, '键盘：回车 preventDefault，避免同一次按键触发两次')
    check(m.pills().length === 0, '键盘：回车填入后整组消失')
    await m.unmount()

    injectCalls.length = 0
    const m2 = await mount({ initial: [{ prompt: '空格填入', reason: '' }] })
    const spaceEvent = keyEvent(' ')
    await m2.fire(m2.pills()[0], 'keydown', spaceEvent)
    check(injectCalls.length === 1 && injectCalls[0].text === '空格填入', '键盘：空格把提示词填入')
    check(m2.pills().length === 0, '键盘：空格填入后整组消失')
    await m2.unmount()
  }

  // ---------- 5. Esc 关整组（焦点在哪都能关） ----------
  {
    injectCalls.length = 0
    const m = await mount({ initial: [{ prompt: '不该被填进去', reason: '' }] })
    await m.fire(document, 'keydown', keyEvent('Escape'))
    check(injectCalls.length === 0, 'Esc：关组不等于选一条，不注入')
    check(m.layer() === null, 'Esc：整组消失')
    await m.unmount()
    // 卸载后监听要摘掉：再按 Esc 不该有任何异常或副作用。
    let threw = false
    try { document.dispatchEvent(keyEvent('Escape')) } catch (eEsc) { threw = true }
    check(threw === false, 'Esc：组件卸载后监听已摘，再按不抛')
  }

  // ---------- 6. 第二组覆盖第一组 ----------
  {
    const m = await mount({ initial: [{ prompt: '旧的一组', reason: '' }] })
    await m.setItems([{ prompt: '新的第一条', reason: '' }, { prompt: '新的第二条', reason: '' }], 7)
    check(m.holder.querySelectorAll('.dsws-sugg-layer').length === 1, '覆盖：任何时刻只有一组气泡层')
    check(m.holder.textContent.indexOf('旧的一组') < 0, '覆盖：旧一组不再显示')
    check(m.pills().length === 2 && m.pills()[0].textContent === '新的第一条', '覆盖：显示的是新一组')
    await m.unmount()
  }

  // ---------- 7. 防御性渲染：条数越界、空数组、坏形状都不崩 ----------
  {
    const m6 = await mount({ initial: [
      { prompt: '一', reason: '' }, { prompt: '二', reason: '' }, { prompt: '三', reason: '' },
      { prompt: '四', reason: '' }, { prompt: '五', reason: '' }, { prompt: '六', reason: '' },
    ] })
    check(m6.pills().length === 4, '防御：超过上限截到 4 颗')
    await m6.unmount()

    const mEmpty = await mount({ initial: [] })
    check(mEmpty.layer() === null && mEmpty.pills().length === 0, '防御：空数组不渲染任何东西')
    await mEmpty.unmount()

    const mBad = await mount({ initial: 'not-an-array' })
    check(mBad.layer() === null && mBad.pills().length === 0, '防御：items 不是数组时安静不渲染')
    await mBad.unmount()

    const mMix = await mount({ initial: [null, {}, { prompt: '' }, { prompt: '好的', reason: 123 }, { prompt: '第二条', reason: '有理由' }] })
    check(mMix.pills().length === 2, '防御：坏条目被过滤，只留 prompt 非空的')
    check(mMix.pills()[0].getAttribute('aria-label') === '好的', '防御：reason 不是字符串就不当理由')
    check(mMix.tooltip() === null, '防御：没有悬停时坏理由也不会生成说明卡片')
    await mMix.fire(mMix.pills()[0], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    check(mMix.tooltip() === null, '防御：reason 不是字符串时悬停也不挂浮层')
    await mMix.fire(mMix.pills()[1], 'mouseover', new win.MouseEvent('mouseover', { bubbles: true, cancelable: true }))
    check(mMix.pills()[1].textContent === '第二条' && mMix.tooltip() !== null && mMix.tooltip().textContent === '理由有理由', '防御：只有字符串理由才显示独立说明卡片，主按钮仍只显示简介')
    await mMix.unmount()
  }

  // ---------- 8. 窄列：正常流主组收在列内，单颗与选项行不溢出 ----------
  {
    const m = await mount({ initial: [{ prompt: '窄栏里也要收住', reason: '' }] })
    const lyr = m.layer()
    check(lyr.style.position === 'relative' && lyr.style.width === '100%', '窄栏：主组仍在正常流中占所在列宽度')
    check(lyr.style.maxWidth === '720px' && m.pills()[0].style.maxWidth === 'min(100%, 360px)', '窄栏：整组与单颗宽度都受旋钮上限约束')
    check(lyr.style.left === '' && lyr.style.bottom === '', '窄栏：不使用视口锚点坐标，不覆盖目标与任务区域')
    await m.unmount()
  }
  // ---------- 9. 样式文本：结构齐、关键尺寸来自外观常量、窄栏 wrap ----------
  {
    const css = stylesMod.SUGGEST_STYLE_TEXT
    check(typeof css === 'string' && css.indexOf('.dsws-sugg-pill') >= 0, '样式：选项样式存在')
    check(css.indexOf('flex-wrap:wrap') >= 0, '样式：选项行可换行（窄栏不溢出）')
    check(css.indexOf('max-width:100%') >= 0, '样式：选项行宽度不超过层')
    check(css.indexOf('max-width:' + appearanceMod.SUGGEST_APPEARANCE.pillMaxWidthPx + 'px') >= 0, '样式：单颗最大宽度来自外观旋钮')
    check(css.indexOf('font-size:' + appearanceMod.SUGGEST_APPEARANCE.pillFontPx + 'px') >= 0, '样式：药丸字号来自外观旋钮')
    check(css.indexOf('border-radius:' + appearanceMod.SUGGEST_APPEARANCE.pillRadiusPx + 'px') >= 0, '样式：圆角来自外观旋钮')
    check(css.indexOf('.dsws-sugg-close') >= 0, '样式：关闭按钮样式存在')
    check(css.indexOf('opacity:' + appearanceMod.SUGGEST_APPEARANCE.closeIdleOpacity) >= 0, '样式：关闭按钮空闲透明度来自外观旋钮')
    check(css.indexOf(':focus-visible') >= 0, '样式：键盘焦点可见')
    check(css.indexOf('.dsws-sugg-sr') >= 0, '样式：读屏节点视觉隐藏')
    check(css.indexOf('--dsw-alias-') >= 0, '样式：颜色走宿主主题 token（亮暗主题都不用另写）')
    check(css.indexOf('.dsws-sugg-intro') >= 0 && css.indexOf('.dsws-sugg-pill-wrap') >= 0 && css.indexOf('.dsws-sugg-pop') >= 0, '样式：简介、浮层定位壳、浮层的样式都在')
    check(css.indexOf('.dsws-sugg-cmd') < 0, '样式：提示词不再进按钮，旧的两段样式已删')
    check(css.indexOf('bottom:calc(100% + ' + appearanceMod.SUGGEST_APPEARANCE.popGapPx + 'px)') >= 0, '样式：浮层固定在框顶边正上方（间距来自外观旋钮，不跟鼠标）')
    check(css.indexOf('max-width:min(' + appearanceMod.SUGGEST_APPEARANCE.popMaxWidthPx + 'px, calc(100vw - ' + (appearanceMod.SUGGEST_APPEARANCE.popViewportMarginPx * 2) + 'px))') >= 0, '样式：浮层最大宽度来自外观旋钮，同时收在视口内（窄窗口不横向溢出）')
    const popRule = (css.match(/\.dsws-sugg-pop\{[^}]*\}/) || [''])[0]
    check(popRule.indexOf('display:block') >= 0 && popRule.indexOf('display:flex') < 0, '样式：浮层按普通文字流排版（不用竖排 flex），评分才能和理由排在同一行')
    check(css.indexOf('.dsws-sugg-pop-row{display:grid') >= 0 && css.indexOf('column-gap:' + appearanceMod.SUGGEST_APPEARANCE.popLabelGapPx + 'px') >= 0, '样式：四行按两列网格排，标签与正文间距来自外观旋钮')
    check(css.indexOf('.dsws-sugg-pop-row + .dsws-sugg-pop-row{margin-top:' + appearanceMod.SUGGEST_APPEARANCE.popRowGapPx + 'px}') >= 0, '样式：行与行之间留空，行距来自外观旋钮')
    check(css.indexOf('.dsws-sugg-pop-label') >= 0 && css.indexOf('.dsws-sugg-pop-value') >= 0, '样式：四行的灰色标签与正文样式都在')
    check(css.indexOf('.dsws-sugg-score') < 0 && css.indexOf('.dsws-sugg-reason') < 0, '样式：旧分数泡与理由同行样式已删（四行取代它们）')
    check(popRule.indexOf('background:' + appearanceMod.SUGGEST_APPEARANCE.popBg) >= 0, '样式：浮层底色取自浮层专用旋钮（比选项框淡一档）')
    check(css.indexOf('body:not([data-ds-dark-theme]) .dsws-sugg-pop{background:' + appearanceMod.SUGGEST_APPEARANCE.lightPopBg) >= 0, '样式：浅色主题下浮层也另给一档更淡的底色')
    check(popRule.indexOf('color:' + appearanceMod.SUGGEST_APPEARANCE.popText) >= 0 && css.indexOf('.dsws-sugg-pop[role="tooltip"]{color:' + appearanceMod.SUGGEST_APPEARANCE.popText) >= 0, '样式：浮层正文用浮层自己的深色文字色，且颜色规则带 role 属性选择器（特异性高过宿主 body [role="tooltip"] 规则，#1834）')
    check(css.indexOf('.dsws-sugg-pop-label{color:' + appearanceMod.SUGGEST_APPEARANCE.popLabelText) >= 0 && (css.match(/\.dsws-sugg-pop-value\{[^}]*\}/) || [''])[0].indexOf('color:' + appearanceMod.SUGGEST_APPEARANCE.popText) >= 0, '样式：四行标签有自己的深色文字色（不用主题次要色），正文也显式写深色、不再只靠继承（#1834）')
    check(popRule.indexOf('backdrop-filter') < 0, '样式：浮层不再做半透明磨砂（改成不透明卡片，标签对比度才稳）')
    check(css.indexOf('--dsw-alias-label-secondary') < 0, '样式：浮层标签与关闭按钮都不再借用主题次要文字色')
    const closeRule = (css.match(/\.dsws-sugg-close\{[^}]*\}/) || [''])[0]
    check(closeRule.indexOf('background:' + appearanceMod.SUGGEST_APPEARANCE.closeBg) >= 0 && closeRule.indexOf('border:1px solid ' + appearanceMod.SUGGEST_APPEARANCE.closeBorder) >= 0 && closeRule.indexOf('color:' + appearanceMod.SUGGEST_APPEARANCE.closeText) >= 0, '样式：关闭按钮有空闲可见的实心底、描边与深色「×」')
    check(css.indexOf('body:not([data-ds-dark-theme]) .dsws-sugg-close{background:' + appearanceMod.SUGGEST_APPEARANCE.lightCloseBg + ';color:' + appearanceMod.SUGGEST_APPEARANCE.lightCloseText) >= 0, '样式：浅色主题的关闭按钮换成反色芯片')
    check(css.indexOf('prefers-reduced-motion') >= 0, '样式：尊重系统减少动效偏好')
  }

  // ---------- 10. 源码守卫：外观旋钮集中、层级常量值不变、界面不越权碰会话 ----------
  {
    const appearanceSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestAppearance.ts'), 'utf8')
    const stylesSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestStyles.ts'), 'utf8')
    const bubbleSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestBubble.ts'), 'utf8')
    const streamSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestStream.ts'), 'utf8')
    const gateSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/suggestGate.ts'), 'utf8')
    const statusBarSrc = fs.readFileSync(path.join(ROOT, 'src/client/statusbar/StatusBar.ts'), 'utf8')
    const panelAssemblySrc = fs.readFileSync(path.join(ROOT, 'src/client/panelAssembly.ts'), 'utf8')
    const indexSrc = fs.readFileSync(path.join(ROOT, 'src/client/index.ts'), 'utf8')
    const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts/build.mts'), 'utf8')
    const leavesSrc = fs.readFileSync(path.join(ROOT, 'tests/verify-leaves.ts'), 'utf8')

    check(appearanceMod.SUGGEST_Z === 0, '守卫：SUGGEST_Z 的具体值是 0（与胶囊同层，#1665）')
    check(appearanceMod.SUGGEST_TOOLTIP_Z === 2147483000, '守卫：tooltip 层级与宿主 HoverTip 相同，能盖过 composer')
    check(/export const SUGGEST_Z = 0/.test(appearanceSrc), '守卫：兼容保留原状态栏层级常量且只有一处定义')
    check(/export const SUGGEST_TOOLTIP_Z = 2147483000/.test(appearanceSrc), '守卫：tooltip 高层级常量集中定义在外观叶子')
    const bubbleCode = codeOnly(bubbleSrc)
    check(bubbleCode.indexOf('SUGGEST_TOOLTIP_Z') >= 0 && !/zIndex:\s*\d/.test(bubbleCode), '守卫：仅说明卡片取 tooltip 专用具名层级，不写字面量')
    const mainLayerStyle = /className:\s*'dsws-sugg-layer'[\s\S]*?style:\s*\{([^}]+)\}/.exec(bubbleCode)
    check(!!mainLayerStyle && !/zIndex|position:\s*['"]fixed/.test(mainLayerStyle[1]), '守卫：主按钮组没有浮层层级或固定定位')
    check(bubbleCode.indexOf('requestAnimationFrame') < 0 && bubbleCode.indexOf('suggestAnchorPollMs') < 0 && bubbleCode.indexOf('ResizeObserver') < 0, '守卫：正常流主组不测量锚点、不用逐帧或尺寸观察器轮询')
    check(bubbleCode.indexOf('PortalOverlay') >= 0 && bubbleCode.indexOf('suggestClampPopToViewport') >= 0, '守卫：单独的说明卡片通过页面浮层并在显示后夹回视口')
    check(bubbleCode.indexOf('addEventListener(\'resize\'') >= 0 && bubbleCode.indexOf('addEventListener(\'scroll\'') >= 0 && bubbleCode.indexOf('removeEventListener(\'resize\'') >= 0 && bubbleCode.indexOf('removeEventListener(\'scroll\'') >= 0, '守卫：说明卡片显示时监听窗口变化，卸载时移除监听')
    check(stylesSrc.indexOf('SUGGEST_APPEARANCE.pillFontPx') >= 0 && stylesSrc.indexOf('12.5') < 0, '守卫：样式尺寸来自外观旋钮，不写死数字')
    check(stylesSrc.indexOf('SUGGEST_APPEARANCE.popText') >= 0 && stylesSrc.indexOf('SUGGEST_APPEARANCE.popLabelText') >= 0 && stylesSrc.indexOf('--dsw-alias-label-secondary') < 0, '守卫：浮层文字用不透明卡片上的深色文字色，不再借主题次要色')
    check(stylesSrc.indexOf('SUGGEST_APPEARANCE.closeBg') >= 0 && stylesSrc.indexOf('SUGGEST_APPEARANCE.closeText') >= 0 && stylesSrc.indexOf('SUGGEST_APPEARANCE.lightCloseBg') >= 0, '守卫：关闭按钮的实心底与反色芯片来自外观旋钮')
    check(stylesSrc.indexOf('SUGGEST_APPEARANCE.popBlurPx') < 0 && stylesSrc.indexOf('SUGGEST_APPEARANCE.popViewportMarginPx') >= 0, '守卫：浮层不再磨砂，宽度同时收在视口内')
    check(stylesSrc.indexOf('--dsw-alias-') >= 0, '守卫：样式颜色只用主题 token')
    check(bubbleSrc.indexOf('setInterval') < 0 && bubbleSrc.indexOf('setTimeout') < 0, '守卫：气泡薄壳不新增定时器')
    check(bubbleSrc.indexOf('requestAnimationFrame') < 0 && bubbleSrc.indexOf('suggestAnchorPollMs') < 0, '守卫：主按钮组正常流，不再逐帧轮询屏幕位置')
    check(bubbleSrc.indexOf('dsws-sugg-pop-shift') >= 0 && bubbleSrc.indexOf('dsws-sugg-pop-shift-y') >= 0 && bubbleSrc.indexOf('suggestPopShiftOf') >= 0, '守卫：浮层靠自己的横向/纵向位移变量夹在视口内（窄窗口不溢出、顶边越界下推；算术取自时间线纯函数）')
    check(bubbleSrc.indexOf('dsws-sugg-intro') >= 0 && bubbleSrc.indexOf('dsws-sugg-pop') >= 0 && bubbleSrc.indexOf('dsws-sugg-pill-wrap') >= 0 && bubbleSrc.indexOf("role: 'tooltip'") >= 0, '守卫：气泡薄壳只印简介、理由进正上方浮层，并保留 role=tooltip（读屏的 aria-describedby 依赖它，不能为绕样式而删，#1834）')
    check(bubbleSrc.indexOf('dsws-sugg-cmd') < 0 && bubbleSrc.indexOf('Tip') < 0, '守卫：按钮里不再有提示词那段，也不再用跟鼠标走的悬停提示')
    check(bubbleCode.indexOf('sessions') < 0 && bubbleCode.indexOf('retain') < 0 && bubbleCode.indexOf('.binding') < 0, '守卫：气泡薄壳不碰会话服务（只读订阅在取数层）')
    check(streamSrc.indexOf('SuggestBubble') >= 0, '接线：取数层的挂载组件把建议交给气泡')
    check(indexSrc.indexOf('leaf:suggestAppearance') >= 0 && indexSrc.indexOf('leaf:suggestStyles') >= 0 && indexSrc.indexOf('leaf:suggestBubble') >= 0, '接线：三片叶子在入口登记了拼接标记')
    check(indexSrc.indexOf('styles.insert(SUGGEST_STYLE_TEXT)') >= 0, '接线：气泡样式走同一个 styles.insert 接缝')
    check(buildSrc.indexOf("id: 'suggestAppearance'") >= 0 && buildSrc.indexOf("id: 'suggestStyles'") >= 0 && buildSrc.indexOf("id: 'suggestBubble'") >= 0, '接线：三片叶子在构建清单登记')
    check(leavesSrc.indexOf('suggestAppearance.ts') >= 0 && leavesSrc.indexOf('suggestStyles.ts') >= 0 && leavesSrc.indexOf('suggestBubble.ts') >= 0, '接线：三片叶子在叶子清单登记（单文件行数上限检查）')
  }

  if (failures.length) {
    console.log('verify-1411-suggest-bubble 失败项：')
    for (const item of failures) console.log('  - ' + item)
  }
  console.log('verify-1411-suggest-bubble：' + total + ' 条断言，' + failures.length + ' 条失败')
  printGateResult('verify-1411-suggest-bubble', total, failures.length ? 1 : 0)
  process.exit(failures.length ? 1 : 0)
}

main().catch(function (err) {
  console.log('verify-1411-suggest-bubble 异常：' + ((err && err.stack) || err))
  printGateResult('verify-1411-suggest-bubble', total, 1)
  process.exit(1)
})
