<template>
  <a href="/" class="flex items-center gap-3 no-underline cursor-pointer group">
    <div class="w-10 h-10 bg-lego-red rounded-sm grid grid-cols-2 grid-rows-2 gap-1 p-1.5">
      <div
        v-for="i in 4"
        :key="i"
        class="bg-lego-yellow rounded-full"
      ></div>
    </div>

    <span class="text-xl font-bold text-gray-900 tracking-tight">
      LEGO
    </span>
  </a>
</template>
