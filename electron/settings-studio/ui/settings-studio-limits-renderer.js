function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

export function renderLimitsSummary(draft, schema) {
    const fields = Array.isArray(schema?.fields) ? schema.fields : [];
    const numberFields = fields.filter((entry) => entry.type === 'number');
    const overrides = draft && typeof draft.limitOverrides === 'object'
        ? draft.limitOverrides
        : {};

    const lines = [];
    lines.push(`Numeric fields: ${numberFields.length}`);
    lines.push(`Limit overrides: ${Object.keys(overrides || {}).length}`);
    lines.push('');

    const previewFields = numberFields.slice(0, 14);
    for (const field of previewFields) {
        const fallback = field?.limits || {};
        const override = overrides[field.path] || {};
        const activeMin = isFiniteNumber(override.min) ? Number(override.min) : Number(fallback.min);
        const activeMax = isFiniteNumber(override.max) ? Number(override.max) : Number(fallback.max);
        const activeStep = isFiniteNumber(override.step) ? Number(override.step) : Number(fallback.step);
        lines.push(`${field.path}`);
        lines.push(`  min=${activeMin} max=${activeMax} step=${activeStep}`);
    }

    if (numberFields.length > previewFields.length) {
        lines.push('');
        lines.push(`... ${numberFields.length - previewFields.length} weitere numerische Felder`);
    }

    return lines.join('\n');
}
