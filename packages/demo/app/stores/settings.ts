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

  const cachePolicyCookie = useCookie('settings-cache-policy', {
    default: () => 'cache-first'
  });

  const relayModeCookie = useCookie('settings-relay-mode', {
    default: () => 'infinite'
  });

  const optimisticCookie = useCookie('settings-optimistic', {
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

  const ssr = ref(ssrCookie.value);
  const cachePolicy = ref(cachePolicyCookie.value);
  const relayMode = ref(relayModeCookie.value);
  const optimistic = ref(optimisticCookie.value);

  watch(ssr, (newValue) => {
    ssrCookie.value = newValue;

    window.location.reload();
  });

  watch(cachePolicy, (newValue) => {
    cachePolicyCookie.value = newValue;

    window.location.reload();
  });

  watch(relayMode, (newValue) => {
    relayModeCookie.value = newValue;

    window.location.reload();
  });

  watch(optimistic, (newValue) => {
    optimisticCookie.value = newValue;

    window.location.reload();
  });

  return {
    ssr,
    cachePolicy,
    relayMode,
    optimistic
  };
});
