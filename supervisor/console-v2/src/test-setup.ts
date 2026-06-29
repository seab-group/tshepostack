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
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, writable: true })
Object.defineProperty(globalThis, 'Event', { value: dom.window.Event, writable: true })
Object.defineProperty(globalThis, 'KeyboardEvent', { value: dom.window.KeyboardEvent, writable: true })

const defaultMq = (_query: string) => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
})
Object.defineProperty(globalThis, 'matchMedia', { value: defaultMq, writable: true, configurable: true })
Object.defineProperty(dom.window, 'matchMedia', { value: defaultMq, writable: true, configurable: true })
