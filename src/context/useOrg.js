import { useContext } from 'react';
import OrgContext from './OrgContext';

export const useOrg = () => {
    const context = useContext(OrgContext);
    if (!context) {
        throw new Error('useOrg must be used within OrgProvider');
    }
    return context;
};
