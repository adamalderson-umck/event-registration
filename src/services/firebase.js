import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// TODO: Replace with actual Firebase config from console
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "event-registration-system.firebaseapp.com",
    projectId: "event-registration-system",
    storageBucket: "event-registration-system.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
