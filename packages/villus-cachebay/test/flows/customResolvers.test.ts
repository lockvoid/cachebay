import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { createCache } from '@/src';
import { tick, type Route } from '@/test/helpers';
import { mountWithClient } from '@/test/helpers/integration';

describe('Resolvers', () => {
  it('transforms nested object to string through resolver', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: {
        User: {
          fullName({ value, set }) {
            // value is an object { firstName, lastName } from the server payload
            set(`${value.firstName} ${value.lastName}`);
          },
        },
      },
    });

    const routes: Route[] = [{
      when: () => true,
      respond: () => ({
        data: {
          __typename: 'Query',
          user: {
            __typename: 'User',
            id: '42',
            email: 'john@example.com',
            fullName: {
              firstName: 'John',
              lastName: 'Doe',
            },
          },
        },
      }),
    }];

    const Component = defineComponent({
      name: 'UserFullName',
      setup() {
        const { useQuery } = require('villus');
        const { data, isFetching } = useQuery({ query: '{ user { __typename id fullName email } }' });
        return () =>
          isFetching.value
            ? h('div', 'Loading...')
            : h('div', {}, [
              h('div', { class: 'fullname' }, data.value.user.fullName),
              h('div', { class: 'email' }, data.value.user.email),
            ]);
      },
    });

    const { wrapper } = await mountWithClient(Component, routes, cache);
    await tick(2);

    expect(wrapper.find('.fullname').text()).toBe('John Doe');
  });

  it('transforms array of objects to a string through resolver', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: {
        Post: {
          tags({ value, set }) {
            // value is an array of { id, name }
            set(value.map((tag: any) => tag.name).join(', '));
          },
        },
      }
    });

    const routes: Route[] = [{
      when: () => true,
      respond: () => ({
        data: {
          __typename: 'Query',
          posts: [
            {
              __typename: 'Post',
              id: '1',
              title: 'Backend',
              tags: [
                { __typename: 'Tag', id: 1, name: 'Rails' },
                { __typename: 'Tag', id: 2, name: 'Laravel' },
              ],
            },
            {
              __typename: 'Post',
              id: '2',
              title: 'Frontend',
              tags: [
                { __typename: 'Tag', id: 3, name: 'Vue' },
                { __typename: 'Tag', id: 4, name: 'React' },
              ],
            },
          ],
        },
      }),
    }];

    const Component = defineComponent({
      name: 'PostTags',
      setup() {
        const { useQuery } = require('villus');
        const { data, isFetching } = useQuery({ query: '{ posts { __typename id title tags } }' });
        return () =>
          isFetching.value
            ? h('div', 'Loading...')
            : h('div', {},
              data.value.posts.map((post: any) =>
                h('div', { id: `post-${post.id}`, key: post.id }, [
                  h('div', { class: 'title' }, post.title),
                  h('div', { class: 'tags' }, post.tags),
                ]),
              ),
            );
      },
    });

    const { wrapper } = await mountWithClient(Component, routes, cache);
    await tick(2);

    expect(wrapper.find('#post-1 .title').text()).toBe('Backend');
    expect(wrapper.find('#post-1 .tags').text()).toBe('Rails, Laravel');

    expect(wrapper.find('#post-2 .title').text()).toBe('Frontend');
    expect(wrapper.find('#post-2 .tags').text()).toBe('Vue, React');
  });

  it('applies multiple resolvers to the same entity (price + categories)', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: {
        Product: {
          price({ value, set }) {
            set(`$${Number(value).toFixed(2)}`);
          },
          categories({ value, set }) {
            set(value.map((c: any) => c.name).join(' > '));
          },
        },
      },
    });

    const routes: Route[] = [{
      when: () => true,
      respond: () => ({
        data: {
          __typename: 'Query',
          product: {
            __typename: 'Product',
            id: '1',
            name: 'Laptop',
            price: 1299.99,
            categories: [
              { __typename: 'Category', id: 1, name: 'Electronics' },
              { __typename: 'Category', id: 2, name: 'Computers' },
              { __typename: 'Category', id: 3, name: 'Laptops' },
            ],
          },
        },
      }),
    }];

    const Component = defineComponent({
      name: 'ProductView',
      setup() {
        const { useQuery } = require('villus');
        // Note: select "price" (resolved), not "displayPrice"
        const { data, isFetching } = useQuery({ query: '{ product { __typename id name price categories } }' });
        return () =>
          isFetching.value
            ? h('div', {}, 'Loading...')
            : h('div', {}, [
              h('div', { class: 'name' }, data.value.product.name),
              h('div', { class: 'price' }, data.value.product.price),
              h('div', { class: 'categories' }, data.value.product.categories),
            ]);
      },
    });

    const { wrapper } = await mountWithClient(Component, routes, cache);
    await tick(2);

    expect(wrapper.find('.name').text()).toBe('Laptop');
    expect(wrapper.find('.price').text()).toBe('$1299.99');
    expect(wrapper.find('.categories').text()).toBe('Electronics > Computers > Laptops');
  });
});
