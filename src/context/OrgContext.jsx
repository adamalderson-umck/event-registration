import React, { createContext, useState, useCallback } from 'react';

const OrgContext = createContext({
    currentOrg: null,
    setCurrentOrg: () => { },
});

export const OrgProvider = ({ children }) => {
    const [currentOrg, setCurrentOrg] = useState(null);

    const updateOrg = useCallback((org) => {
        setCurrentOrg(org);
    }, []);

    return (
        <OrgContext.Provider value={{ currentOrg, setCurrentOrg: updateOrg }}>
            {children}
        </OrgContext.Provider>
    );
};

OrgProvider.displayName = 'OrgProvider';

export default OrgContext;
