<script setup>
  const settings = useSettings();
</script>

<template>
  <header class="relative bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 border-b border-purple-500/20 shadow-lg">
    <div class="relative flex flex-row items-center px-6 py-4">
      <AppLogo />

      <div class="ml-auto flex items-center gap-4 px-6 py-3 bg-slate-800/50 backdrop-blur-sm border border-purple-500/20 rounded-xl shadow-lg">
        <label class="flex items-center gap-2 text-xs">
          <span class="text-purple-200 font-medium">
            Cache
          </span>

          <select v-model="settings.cachePolicy" class="bg-slate-700 border border-purple-500/30 rounded-md px-2 py-1 text-xs text-purple-100 focus:border-purple-400 focus:ring-1 focus:ring-purple-400 focus:outline-none">
            <option value="cache-and-network">
              Cache & Network
            </option>

            <option value="cache-first">
              Cache First
            </option>

            <option value="cache-only">
              Cache Only
            </option>
          </select>
        </label>

        <label class="flex items-center gap-2 text-xs">
          <span class="text-purple-200 font-medium">
            Relay
          </span>

          <select v-model="settings.relayMode" class="bg-slate-700 border border-purple-500/30 rounded-md px-2 py-1 text-xs text-purple-100 focus:border-purple-400 focus:ring-1 focus:ring-purple-400 focus:outline-none">
            <option value="append">
              Append
            </option>

            <option value="replace">
              Replace
            </option>
          </select>
        </label>

        <div class="flex items-center gap-3 text-xs">
          <label class="flex items-center gap-1.5 cursor-pointer group">
            <input v-model="settings.ssr" type="checkbox" class="w-3 h-3 text-purple-500 bg-slate-700 border-purple-500/30 rounded focus:ring-purple-400 focus:ring-1" />

            <span class="text-purple-200 group-hover:text-purple-100 transition-colors">
              SSR
            </span>
          </label>

          <label class="flex items-center gap-1.5 cursor-pointer group">
            <input v-model="settings.suspense" type="checkbox" class="w-3 h-3 text-purple-500 bg-slate-700 border-purple-500/30 rounded focus:ring-purple-400 focus:ring-1" />

            <span class="text-purple-200 group-hover:text-purple-100 transition-colors">
              Suspense
            </span>
          </label>

          <label class="flex items-center gap-1.5 cursor-pointer group">
            <input v-model="settings.optimistic" type="checkbox" class="w-3 h-3 text-purple-500 bg-slate-700 border-purple-500/30 rounded focus:ring-purple-400 focus:ring-1" />

            <span class="text-purple-200 group-hover:text-purple-100 transition-colors">
              Optimistic
            </span>
          </label>
        </div>
      </div>
    </div>
  </header>
</template>
