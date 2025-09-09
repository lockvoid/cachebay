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

  const ssr = ref(ssrCookie.value);
  const suspense = ref(suspenseCookie.value);
  const cachePolicy = ref(cachePolicyCookie.value);

  watch(ssr, (newValue) => {
    ssrCookie.value = newValue;
  });

  watch(suspense, (newValue) => {
    suspenseCookie.value = newValue;
  });

  watch(cachePolicy, (newValue) => {
    cachePolicyCookie.value = newValue;
  });

  return {
    ssr,
    suspense,
    cachePolicy
  };
});
