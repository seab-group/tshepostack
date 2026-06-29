import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
})

Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true })
Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true })
Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, writable: true })
Object.defineProperty(globalThis, 'SVGElement', { value: dom.window.SVGElement, writable: true })
Object.defineProperty(globalThis, 'Element', { value: dom.window.Element, writable: true })
Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, writable: true })
Object.defineProperty(globalThis, 'Text', { value: dom.window.Text, writable: true })
Object.defineProperty(globalThis, 'Comment', { value: dom.window.Comment, writable: true })
Object.defineProperty(globalThis, 'DocumentFragment', { value: dom.window.DocumentFragment, writable: true })
Object.defineProperty(globalThis, 'MutationObserver', { value: dom.window.MutationObserver, writable: true })
Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle.bind(dom.window), writable: true })
Object.defineProperty(globalThis, 'CustomEvent', { value: dom.window.CustomEvent, writable: true })

// requestAnimationFrame: fire via Promise microtask so animations complete inside `act()`
let _rafId = 0
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  value: (cb: FrameRequestCallback): number => {
    const id = ++_rafId
    Promise.resolve().then(() => cb(0))
    return id
  },
  writable: true,
  configurable: true,
})
Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  value: (_id: number) => {},
  writable: true,
  configurable: true,
})
