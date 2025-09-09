import { defineStore } from 'pinia';

export const useSettings = defineStore('settings', () => {
  const ssrCookie = useCookie('settings-ssr', {
    default: () => true,

    serializer: {
      read: (value) => {
        return value === 'true';
      },

      write: (value) => {
        return String(value);
      }
    }
  });

  const suspenseCookie = useCookie('settings-suspense', {
    default: () => true,

    serializer: {
      read: (value) => {
        return value === 'true';
      },

      write: (value) => {
        return String(value);
      }
    }
  });

  const cachePolicyCookie = useCookie('settings-cache-policy', {
    default: () => 'cache-and-network' as string
  });

  const relayModeCookie = useCookie('settings-relay-mode', {
    default: () => 'append' as string
  });

  const ssr = ref(ssrCookie.value ?? true);
  const suspense = ref(suspenseCookie.value ?? true);
  const cachePolicy = ref(cachePolicyCookie.value ?? 'cache-and-network');
  const relayMode = ref(relayModeCookie.value ?? 'append');

  watch(ssr, (newValue) => {
    ssrCookie.value = newValue;
  });

  watch(suspense, (newValue) => {
    suspenseCookie.value = newValue;
  });

  watch(cachePolicy, (newValue) => {
    cachePolicyCookie.value = newValue;
  });

  watch(relayMode, (newValue) => {
    relayModeCookie.value = newValue;
  });

  return {
    ssr,
    suspense,
    cachePolicy,
    relayMode
  };
});
