export const MOBILE_CLASSIC_FALLBACK_GITHUB_REPOSITORY = 'curviosclash-gif/Rohre-3D-erster-stand';

export function normalizeMobileClassicGithubRepository(
    value = '',
    fallbackRepository = MOBILE_CLASSIC_FALLBACK_GITHUB_REPOSITORY
) {
    const repository = String(value || '').trim()
        .replace(/^https:\/\/github\.com\//, '')
        .replace(/^git@github\.com:/, '')
        .replace(/\.git$/, '')
        .replace(/^\/+|\/+$/g, '');
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
        ? repository
        : fallbackRepository;
}

export function createMobileClassicGithubUpdateConfig(repository = MOBILE_CLASSIC_FALLBACK_GITHUB_REPOSITORY) {
    const normalizedRepository = normalizeMobileClassicGithubRepository(repository);
    return {
        provider: 'github-releases',
        repository: normalizedRepository,
        apiUrl: `https://api.github.com/repos/${normalizedRepository}/releases/latest`,
        latestReleaseUrl: `https://github.com/${normalizedRepository}/releases/latest`,
    };
}

export function normalizeMobileClassicUpdateConfig(source = null) {
    const updates = source?.updates && typeof source.updates === 'object'
        ? source.updates
        : (source && typeof source === 'object' ? source : {});
    const fallback = createMobileClassicGithubUpdateConfig();
    const repository = normalizeMobileClassicGithubRepository(updates.repository || fallback.repository);
    const defaults = createMobileClassicGithubUpdateConfig(repository);
    return {
        ...defaults,
        ...updates,
        repository,
        apiUrl: updates.apiUrl || defaults.apiUrl,
        latestReleaseUrl: updates.latestReleaseUrl || defaults.latestReleaseUrl,
    };
}
