<template>
  <div class="flex flex-col items-center gap-6 p-8">
    <h1 class="text-3xl font-bold text-gray-900">Harry Potter Spells Demo</h1>
    <p class="text-lg text-gray-600 text-center max-w-2xl">
      This is a demo of <a href="https://github.com/villus/villus-cachebay" class="text-blue-600 hover:text-blue-800 underline">Villus Cachebay</a> 
      showcasing GraphQL caching with Harry Potter spells data.
    </p>
    <NuxtLink to="/spells" class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
      Browse Spells ✨
    </NuxtLink>
  </div>
</template>