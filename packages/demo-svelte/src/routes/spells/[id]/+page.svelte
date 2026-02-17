<script lang="ts">
  import { page } from "$app/stores";
  import SpellShow from "../../../components/SpellShow.svelte";
</script>

<div class="bg-gray-100 p-6">
  <SpellShow spellId={$page.params.id} />
</div>
