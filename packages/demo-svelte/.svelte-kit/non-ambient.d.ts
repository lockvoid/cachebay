
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	export interface AppTypes {
		RouteId(): "/" | "/api" | "/api/graphql" | "/spells" | "/spells/new" | "/spells/[id]" | "/spells/[id]/edit";
		RouteParams(): {
			"/spells/[id]": { id: string };
			"/spells/[id]/edit": { id: string }
		};
		LayoutParams(): {
			"/": { id?: string };
			"/api": Record<string, never>;
			"/api/graphql": Record<string, never>;
			"/spells": { id?: string };
			"/spells/new": Record<string, never>;
			"/spells/[id]": { id: string };
			"/spells/[id]/edit": { id: string }
		};
		Pathname(): "/" | "/api/graphql" | "/spells/new" | `/spells/${string}` & {} | `/spells/${string}/edit` & {};
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/apple-touch-icon.png" | "/favicon.ico" | "/icon-192x192.png" | "/icon-512x512.png" | "/icon.svg" | "/site.webmanifest" | string & {};
	}
}