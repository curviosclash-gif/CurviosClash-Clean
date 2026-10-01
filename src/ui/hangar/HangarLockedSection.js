// A hangar area that is visible before it is unlocked (Plan, Hangar-Bedienung: "alles ist von
// Anfang an sichtbar; gesperrte Bereiche sind abgedunkelt und nennen ihre Bedingung").
// While locked, the body is dimmed and cannot be used - a disabled <fieldset> disables every
// button and field inside it natively (no clicks, no keyboard focus) - and a line above it names
// the condition, optionally with the action that lifts the lock (a purchase button) beside it.
// Used by the size workshop and the storage tiers; meant for stone slots, machine guns and the Lab.
import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';

let conditionCount = 0;

/**
 * @param {{ className?: string, action?: HTMLElement|null }} [options]
 *   action: stays usable next to the condition while the body is locked.
 */
export function createHangarLockedSection({ className = '', action = null } = {}) {
    const root = el('div', `hangar-locked-section ${className}`.trim());
    const head = el('div', 'hangar-locked-head hidden');
    const condition = el('p', 'hangar-locked-condition');
    conditionCount += 1;
    condition.id = `hangar-locked-condition-${conditionCount}`;
    head.append(condition);
    if (action) head.append(action);
    const body = document.createElement('fieldset');
    body.className = 'hangar-locked-body';
    root.append(head, body);

    return Object.freeze({
        root,
        /** Put the lockable controls in here. */
        body,
        condition,
        /**
         * @param {boolean} locked
         * @param {string} [conditionText] what unlocks the area, e.g. "Utility auf 115 % bringen"
         */
        setLocked(locked, conditionText = '') {
            const on = locked === true;
            root.classList.toggle('is-locked', on);
            head.classList.toggle('hidden', !on);
            condition.textContent = on ? conditionText : '';
            body.disabled = on;
            if (on) {
                body.setAttribute('aria-disabled', 'true');
                body.setAttribute('aria-describedby', condition.id);
            } else {
                body.removeAttribute('aria-disabled');
                body.removeAttribute('aria-describedby');
            }
        },
    });
}
