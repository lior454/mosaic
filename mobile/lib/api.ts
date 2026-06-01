import axios from 'axios';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.100:3001';

export const api = axios.create({ baseURL: BASE_URL });
