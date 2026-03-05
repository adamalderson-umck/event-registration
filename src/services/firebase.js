import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyCRD3xJf8Z5QVAfXpY6RFRYhg07YAkj16s",
    authDomain: "event-registration-b7840.firebaseapp.com",
    projectId: "event-registration-b7840",
    storageBucket: "event-registration-b7840.firebasestorage.app",
    messagingSenderId: "572635504019",
    appId: "1:572635504019:web:7dcb6e42a7aee573e01c66",
    measurementId: "G-YQ8YLTPH4M"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
