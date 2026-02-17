<script lang="ts">
  let { value = $bindable(""), placeholder = "Search...", ...rest }: { value?: string; placeholder?: string; [key: string]: any } = $props();
</script>

<input
  {...rest}
  bind:value
  type="text"
  {placeholder}
  class="w-full rounded-full border-2 border-gray-300 px-3 py-2 font-serif focus:border-blue-500 focus:outline-none"
  autofocus
/>
