import { useContext } from 'react';
import AppModeContext from './AppModeContext';

export const useAppMode = () => {
    const context = useContext(AppModeContext);
    if (!context) {
        throw new Error('useAppMode must be used within AppModeProvider');
    }
    return context;
};
