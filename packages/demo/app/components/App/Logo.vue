<template>
  <NuxtLink to="/" class="flex items-center gap-3 no-underline cursor-pointer group">
    <div class="relative w-12 h-12 bg-gradient-to-br from-amber-400 via-yellow-500 to-amber-600 rounded-full flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all duration-300 group-hover:scale-105">
      <div class="absolute inset-0 bg-gradient-to-br from-amber-300 to-amber-700 rounded-full opacity-50"></div>
      <span class="relative text-2xl font-bold text-amber-900 drop-shadow-sm">⚡</span>
      <div class="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center">
        <span class="text-xs text-white">✨</span>
      </div>
    </div>

    <div class="flex flex-col">
      <span class="text-xl font-bold text-white tracking-tight">
        Harry Potter
      </span>
      <span class="text-xs text-gray-500 font-medium tracking-wide">
        Magical Spellbook Cache
      </span>
    </div>
  </NuxtLink>
</template>
