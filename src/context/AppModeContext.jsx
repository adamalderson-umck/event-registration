import React, { createContext, useState } from 'react';

const AppModeContext = createContext({
    mode: 'standalone',
    isStandalone: true,
    isEmbed: false,
    eventId: null,
    orgId: null,
});

export const AppModeProvider = ({ children }) => {
    const [state] = useState(() => {
        const rootElement = document.getElementById('root');
        const dataMode = rootElement?.getAttribute('data-mode');
        const eventId = rootElement?.getAttribute('data-event-id');
        const orgId = rootElement?.getAttribute('data-org-id');
        const mode = dataMode === 'embed' ? 'embed' : 'standalone';

        return {
            mode,
            isStandalone: mode === 'standalone',
            isEmbed: mode === 'embed',
            eventId: eventId || null,
            orgId: orgId || null,
        };
    });

    return (
        <AppModeContext.Provider value={state}>
            {children}
        </AppModeContext.Provider>
    );
};

AppModeProvider.displayName = 'AppModeProvider';

export default AppModeContext;
