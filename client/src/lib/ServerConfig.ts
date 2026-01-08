const SERVER_DOMAIN_KEY = 'server_domain';
const DEFAULT_DOMAIN = 'localhost';

const getDomain = (): string => {
  return localStorage.getItem(SERVER_DOMAIN_KEY) || DEFAULT_DOMAIN;
};

const setDomain = (domain: string): void => {
  localStorage.setItem(SERVER_DOMAIN_KEY, domain);
};

const clearDomain = (): void => {
  localStorage.removeItem(SERVER_DOMAIN_KEY);
};

const getHttpUrl = (): string => {
  return `https://${getDomain()}:3000`;
};

const getWsUrl = (): string => {
  return `wss://${getDomain()}:3000`;
};

const getLiveKitUrl = (): string => {
  return `wss://${getDomain()}:7880`;
};

export {
  getDomain,
  setDomain,
  clearDomain,
  getHttpUrl,
  getWsUrl,
  getLiveKitUrl,
  DEFAULT_DOMAIN,
};
