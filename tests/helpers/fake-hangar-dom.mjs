// Node has no browser: this small document stand-in records what the hangar panels build.
// Enter on a button clicks like in Chromium unless a keydown listener prevented it, and a
// button inside a disabled <fieldset> ignores clicks like a disabled form control does.
// Importing the module installs it as globalThis.document.

class FakeClassList {
    constructor() { this.values = new Set(); }
    add(...names) { names.forEach((name) => this.values.add(name)); }
    remove(...names) { names.forEach((name) => this.values.delete(name)); }
    toggle(name, force) {
        const on = force === undefined ? !this.values.has(name) : !!force;
        if (on) this.values.add(name); else this.values.delete(name);
        return on;
    }
    contains(name) { return this.values.has(name); }
}

function matches(node, selector) {
    if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
    const data = /^\[data-([a-z-]+)\]$/.exec(selector);
    if (!data) throw new Error(`selector not supported: ${selector}`);
    const key = data[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    return node.dataset[key] !== undefined;
}

/** A form control is disabled by its own flag or by a disabled <fieldset> around it. */
function isDisabledControl(node) {
    for (let current = node; current; current = current.parentElement) {
        if (current.disabled && (current === node || current.tagName === 'FIELDSET')) return true;
    }
    return false;
}

export class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.attributes = new Map();
        this.dataset = {};
        this.classList = new FakeClassList();
        this.listeners = {};
        this.textContent = '';
        this.disabled = false;
        this.type = '';
        this.id = '';
        this.value = '';
        this.tabIndex = 0;
    }
    set className(value) {
        this.classList = new FakeClassList();
        String(value).split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
    }
    get className() { return [...this.classList.values].join(' '); }
    get title() { return this.attributes.get('title') ?? ''; }
    set title(value) { this.attributes.set('title', String(value)); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) {
        for (const node of nodes) {
            if (typeof node === 'string') { this.textContent += node; continue; }
            node.parentElement = this;
            this.children.push(node);
        }
    }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) {
        this.children.forEach((child) => { child.parentElement = null; });
        this.children = [];
        this.append(...nodes);
    }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    removeEventListener() {}
    dispatchEvent(event) {
        event.target ||= this;
        for (let node = this; node && !event.stopped; node = node.parentElement) {
            (node.listeners[event.type] || []).forEach((handler) => handler(event));
        }
        return !event.defaultPrevented;
    }
    click() { if (!isDisabledControl(this)) this.dispatchEvent(createEvent('click')); }
    focus() { if (isUsable(this)) fakeDocument.activeElement = this; }
    closest(selector) {
        for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node;
        return null;
    }
    contains(node) {
        for (let current = node; current; current = current.parentElement) if (current === this) return true;
        return false;
    }
    querySelectorAll(selector) {
        const found = [];
        const walk = (node) => node.children.forEach((child) => { if (matches(child, selector)) found.push(child); walk(child); });
        walk(this);
        return found;
    }
}

export function createEvent(type, extra = {}) {
    return {
        type, defaultPrevented: false, stopped: false, ...extra,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.stopped = true; },
    };
}

/** Visible and not disabled: no hidden or disabled node on the way up. */
export function isUsable(node) {
    for (let current = node; current; current = current.parentElement) {
        if (current.disabled || current.classList.contains('hidden')) return false;
    }
    return true;
}

/** Visible: no node on the way up carries the class "hidden". */
export function isShown(node) {
    for (let current = node; current; current = current.parentElement) {
        if (current.classList.contains('hidden')) return false;
    }
    return true;
}

export const fakeDocument = {
    activeElement: null,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => Object.assign(new FakeElement('#text'), { textContent: String(text) }),
};
globalThis.document = fakeDocument;

export const bind = (node, type, handler) => node.addEventListener(type, handler);

/** Enter on a focused button: keydown bubbles, then Chromium clicks unless a listener prevented it. */
export function pressEnter(node, repeat = false) {
    const event = createEvent('keydown', { key: 'Enter', repeat, target: node });
    node.dispatchEvent(event);
    if (!event.defaultPrevented && node.tagName === 'BUTTON') node.click();
}

/** The node itself or its first descendant with that class. */
export function find(root, className) {
    return root.classList.contains(className) ? root : root.querySelectorAll(`.${className}`)[0];
}
