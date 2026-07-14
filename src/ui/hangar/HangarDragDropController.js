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
        drag.avatar?.remove();
        if (drag.active) {
            try { drag.source.releasePointerCapture?.(drag.pointerId); } catch { /* pointer may already be released */ }
        }
        drag = null;
        options.onCancel?.(reason);
    }

    function activate(event) {
        if (!drag || drag.active) return;
        drag.active = true;
        drag.avatar = document.createElement('div');
        drag.avatar.className = 'hangar-drag-avatar';
        drag.avatar.textContent = String(drag.payload.label || drag.payload.partId);
        document.body.appendChild(drag.avatar);
        drag.source.setPointerCapture?.(drag.pointerId);
        event.preventDefault();
        options.onStart?.(drag.payload);
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
        if (!drag.active) {
            const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
            if (distance < 6) return;
            activate(event);
        }
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
        if (!drag.active) {
            drag = null;
            return;
        }
        const result = drag.evaluation;
        const payload = drag.payload;
        const target = drag.target;
        const source = drag.source;
        event.preventDefault();
        source.dataset.hangarSuppressClick = 'true';
        window.setTimeout(() => { delete source.dataset.hangarSuppressClick; }, 0);
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
        drag = {
            pointerId: event.pointerId,
            source,
            payload,
            avatar: null,
            target: null,
            evaluation: null,
            active: false,
            startX: event.clientX,
            startY: event.clientY,
        };
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
        isDragging: () => Boolean(drag?.active),
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
