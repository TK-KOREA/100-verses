// 알림 0단계: Firebase 웹 앱 설정과 웹 푸시 인증서(VAPID 공개 키). 모두 공개 값이다(비밀 아님).
// Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) / 클라우드 메시징 → 웹 푸시 인증서에서 복사한다.
export const FIREBASE = {
  apiKey: 'AIzaSyCKgcT28hSG0BzYs43Aul1ces6UkVPJR6Q',
  authDomain: 'malsseum-boseok.firebaseapp.com',
  projectId: 'malsseum-boseok',
  storageBucket: 'malsseum-boseok.firebasestorage.app',
  messagingSenderId: '1001216982151',
  appId: '1:1001216982151:web:b2c14956737a36c3114c22',
};
export const VAPID_KEY = 'BNJRUPttQdwufKGO9KRDORRJnfo7xQhfjUipGNNC6B3yiVIH9hdFs-7j0NrG6xYK49WNVkpAA2IBpXjz1koHj5Q';
