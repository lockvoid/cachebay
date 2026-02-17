<script lang="ts">
  import { page } from "$app/stores";
  import SpellEdit from "../../../../components/SpellEdit.svelte";
</script>

<div class="bg-gray-100 p-6">
  <SpellEdit spellId={$page.params.id} />
</div>
