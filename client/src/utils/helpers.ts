// Build a usable cover URL. The new bookshelf API returns absolute URLs
// (https://covers.storytel.com/...); the legacy API returned relative paths
// that needed the www.storytel.com host prepended. Storytel only serves the
// 640px variant, so there is no smaller size to request.
export const buildCoverUrl = (cover?: string | null): string => {
    if (!cover) return '';
    return /^(https?|file|data):/i.test(cover) ? cover : `https://www.storytel.com${cover}`;
};

// Turn an ISO language code (e.g. "de") into a name localized in the given UI
// locale (e.g. "Deutsch"/"Tedesco"). Falls back to the raw code if unsupported.
export const localizedLanguageName = (code?: string | null, uiLocale = 'en'): string => {
    if (!code) return '';
    try {
        return new Intl.DisplayNames([uiLocale], {type: 'language'}).of(code) || code;
    } catch {
        return code;
    }
};

export const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
};


export const formatMicrosecondsTime = (microseconds: number) => {
    const totalSeconds = Math.floor(microseconds / 1000 / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours} h ${minutes} min`;
};

export const formatTimeNatural = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}min`);
    }
    if (secs > 0 || parts.length === 0) {
        parts.push(`${secs}s`);
    }

    return parts.join(' ');
};

export const truncateTitle = (title: string, maxLength: number = 30): string => {
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength - 3) + '...';
};
