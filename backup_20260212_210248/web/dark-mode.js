// Dark mode toggle for PDF.js viewer
// Dark mode toggle for PDF.js viewer
(function () {
    const STORAGE_KEY = 'pdfjs-dark-mode';
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Helper to set the native PDF.js theme
    // theme: 0=Auto, 1=Light, 2=Dark
    function setNativeTheme(theme) {
        if (window.PDFViewerApplicationOptions) {
            window.PDFViewerApplicationOptions.set('viewerCssTheme', theme);
        }
    }

    // Main function to update UI based on state
    function updateTheme() {
        const savedMode = localStorage.getItem(STORAGE_KEY);
        // Determine effective mode:
        // If savedMode is 'dark' -> force dark
        // If savedMode is 'light' -> force light
        // If savedMode is null -> use system preference

        let isDark;
        let nativeThemeVal;

        if (savedMode === 'dark') {
            isDark = true;
            nativeThemeVal = 2; // Dark
        } else if (savedMode === 'light') {
            isDark = false;
            nativeThemeVal = 1; // Light
        } else {
            // Auto mode
            isDark = mediaQuery.matches;
            nativeThemeVal = 0; // Auto - Let PDF.js handle UI for consistency
        }

        // Apply to Document
        if (isDark) {
            document.documentElement.classList.add('dark-mode');
            document.body.classList.add('dark-mode');
        } else {
            document.documentElement.classList.remove('dark-mode');
            document.body.classList.remove('dark-mode');
        }

        // Update Toggle Button Icon
        const btn = document.getElementById('darkModeToggle');
        if (btn) {
            btn.innerHTML = isDark ? '<span>☀️</span>' : '<span>🌙</span>';
        }

        // Update Native PDF.js Theme
        // We can set this immediately if app is ready, or wait
        const app = window.PDFViewerApplication;
        if (app && app.initialized) {
            setNativeTheme(nativeThemeVal);
        } else {
            window.addEventListener('webviewerloaded', () => {
                setNativeTheme(nativeThemeVal);
            }, { once: true });
        }
    }

    // System Preference Listener
    mediaQuery.addEventListener('change', updateTheme);

    // Create toggle button
    const btn = document.createElement('button');
    btn.id = 'darkModeToggle';
    btn.className = 'toolbarButton';
    btn.title = 'Toggle dark mode';
    btn.tabIndex = 0;

    btn.onclick = function () {
        const currentIsDark = document.body.classList.contains('dark-mode');
        // If currently dark, we want light (saved='light')
        // If currently light, we want dark (saved='dark')
        // NOTE: This simple toggle acts as an override. 
        // To return to "Auto", one would need a clearer UI, but for now, 
        // toggling implies setting a manual preference.

        const newMode = currentIsDark ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEY, newMode);
        updateTheme();
    };

    // Insert into toolbar
    // We defer slightly to ensure toolbar exists, or check immediately
    function insertButton() {
        const toolbar = document.getElementById('toolbarViewerRight');
        if (toolbar) {
            if (document.getElementById('darkModeToggle')) return; // already inserted

            const secondaryToggle = document.getElementById('secondaryToolbarToggle');
            if (secondaryToggle) {
                toolbar.insertBefore(btn, secondaryToggle);
            } else {
                toolbar.appendChild(btn);
            }
        } else {
            // Fallback if script runs too early?
            document.body.appendChild(btn);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', insertButton);
    } else {
        insertButton();
    }

    // Initial Run
    updateTheme();

})();
