export function createHangarDragDropController(options = {}) {
    const viewport = options.viewport || null;
    const evaluateTarget = typeof options.evaluateTarget === 'function' ? options.evaluateTarget : () => ({ ok: false });
    const onDrop = typeof options.onDrop === 'function' ? options.onDrop : () => {};
    const onReject = typeof options.onReject === 'function' ? options.onReject : () => {};
    const sourceCleanups = [];
    let drag = null;

    function clearTarget() {
        document.querySelectorAll('[data-hangar-slot].is-drop-target, [data-hangar-slot].is-drop-invalid')
            .forEach((node) => node.classList.remove('is-drop-target', 'is-drop-invalid'));
        document.querySelectorAll('[data-hangar-remove-zone].is-drop-target')
            .forEach((node) => node.classList.remove('is-drop-target'));
    }

    function cancel(reason = 'cancelled') {
        if (!drag) return;
        clearTarget();
        viewport?.clearDragPreview?.();
        drag.avatar.remove();
        try { drag.source.releasePointerCapture?.(drag.pointerId); } catch { /* pointer may already be released */ }
        drag = null;
        options.onCancel?.(reason);
    }

    function targetAt(clientX, clientY) {
        const element = document.elementFromPoint(clientX, clientY);
        const removeZone = element?.closest?.('[data-hangar-remove-zone]');
        if (removeZone && drag?.payload?.sourceSlotId) return { type: 'remove', element: removeZone, slotId: drag.payload.sourceSlotId };
        const slot = element?.closest?.('[data-hangar-slot]');
        if (slot) return { type: 'slot', element: slot, slotId: String(slot.dataset.hangarSlot || '') };
        const raycastSlotId = viewport?.hitTestHardpoint?.(clientX, clientY);
        return raycastSlotId ? { type: 'slot', element: null, slotId: raycastSlotId } : null;
    }

    function move(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.avatar.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
        clearTarget();
        const target = targetAt(event.clientX, event.clientY);
        drag.target = target;
        drag.evaluation = target ? evaluateTarget(drag.payload, target) : { ok: false, code: 'no_target' };
        if (!target) {
            viewport?.clearDragPreview?.();
            return;
        }
        target.element?.classList.add(drag.evaluation.ok ? 'is-drop-target' : 'is-drop-invalid');
        if (target.type === 'slot') viewport?.setDragPreview?.(drag.payload.partId, target.slotId, drag.evaluation.ok);
        else viewport?.clearDragPreview?.();
    }

    function end(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const result = drag.evaluation;
        const payload = drag.payload;
        const target = drag.target;
        cancel('drop');
        if (target && result?.ok) onDrop(payload, target, result);
        else onReject(result || { ok: false, code: 'no_target', message: 'Kein kompatibler Slot gewählt' });
    }

    function onKeyDown(event) {
        if (event.key === 'Escape' && drag) {
            event.preventDefault();
            cancel('escape');
        }
    }

    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
    document.addEventListener('keydown', onKeyDown, true);

    function begin(event, payload, source = event?.currentTarget) {
        if (!event || event.button !== 0 || drag || !source) return false;
        if (!payload?.partId || payload.locked) {
            if (payload?.lockedReason) onReject({ ok: false, code: 'part_locked', message: payload.lockedReason });
            return false;
        }
        event.preventDefault();
        const avatar = document.createElement('div');
        avatar.className = 'hangar-drag-avatar';
        avatar.textContent = String(payload.label || payload.partId);
        document.body.appendChild(avatar);
        drag = { pointerId: event.pointerId, source, payload, avatar, target: null, evaluation: null };
        source.setPointerCapture?.(event.pointerId);
        move(event);
        options.onStart?.(payload);
        return true;
    }

    function attachSource(element, getPayload) {
        const handler = (event) => {
            const payload = typeof getPayload === 'function' ? getPayload(event) : getPayload;
            begin(event, payload, element);
        };
        element.addEventListener('pointerdown', handler);
        sourceCleanups.push(() => element.removeEventListener('pointerdown', handler));
    }

    return Object.freeze({
        begin,
        attachSource,
        cancel,
        isDragging: () => Boolean(drag),
        dispose() {
            cancel('dispose');
            sourceCleanups.splice(0).forEach((cleanup) => cleanup());
            document.removeEventListener('pointermove', move, true);
            document.removeEventListener('pointerup', end, true);
            document.removeEventListener('pointercancel', end, true);
            document.removeEventListener('keydown', onKeyDown, true);
        },
    });
}
