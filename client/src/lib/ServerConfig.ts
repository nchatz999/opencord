const SERVER_URL_KEY = 'server_url';
const DEFAULT_SERVER_URL = 'https://localhost';

const getServerUrl = (): string | null => {
  return localStorage.getItem(SERVER_URL_KEY);
};

const getServerUrlOrDefault = (): string => {
  return localStorage.getItem(SERVER_URL_KEY) || DEFAULT_SERVER_URL;
};

const setServerUrl = (url: string): void => {
  localStorage.setItem(SERVER_URL_KEY, url);
};

const clearServerUrl = (): void => {
  localStorage.removeItem(SERVER_URL_KEY);
};

export {
  getServerUrl,
  getServerUrlOrDefault,
  setServerUrl,
  clearServerUrl,
  DEFAULT_SERVER_URL,
};
