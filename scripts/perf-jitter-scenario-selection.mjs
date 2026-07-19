export function selectBenchmarkScenarios(matrix = [], filters = [], limit = 4) {
    const normalizedFilters = Array.isArray(filters) ? filters : [];
    return matrix
        .filter((scenario) => {
            if (normalizedFilters.length === 0) return true;
            return normalizedFilters.includes(String(scenario?.id || '').toUpperCase());
        })
        .slice(0, Math.max(0, Number(limit) || 0));
}
