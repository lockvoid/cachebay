export type User = {
  id: string;
  name: string;
  avatar: string;
  postIds: string[];
  followerIds: string[];
};

export type Post = {
  id: string;
  title: string;
  content: string;
  authorId: string;
  commentIds: string[];
  likeCount: number;
};

export type Comment = {
  id: string;
  text: string;
  authorId: string;
  postId: string;
};

export type NestedDataset = {
  users: Map<string, User>;
  posts: Map<string, Post>;
  comments: Map<string, Comment>;
};

function mulberry32(seed: number) {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MakeNestedDatasetOptions = {
  userCount?: number;
  postsPerUser?: number;
  commentsPerPost?: number;
  followersPerUser?: number;
  seed?: number;
};

export function makeNestedDataset(options: MakeNestedDatasetOptions = {}): NestedDataset {
  const {
    userCount = 5000,
    postsPerUser = 20,
    commentsPerPost = 10,
    followersPerUser = 15,
    seed = 12345,
  } = options;
  const rnd = mulberry32(seed);
  
  const users = new Map<string, User>();
  const posts = new Map<string, Post>();
  const comments = new Map<string, Comment>();

  // Create users
  for (let i = 0; i < userCount; i++) {
    const userId = `u${i + 1}`;
    const nameHash = Math.floor(rnd() * 1e6).toString(36);
    users.set(userId, {
      id: userId,
      name: `User ${i + 1} ${nameHash}`,
      avatar: `https://i.pravatar.cc/150?u=${userId}`,
      postIds: [],
      followerIds: [],
    });
  }

  // Create posts for each user
  let postCounter = 1;
  for (const user of users.values()) {
    for (let i = 0; i < postsPerUser; i++) {
      const postId = `p${postCounter++}`;
      const titleHash = Math.floor(rnd() * 1e6).toString(36);
      const contentHash = Math.floor(rnd() * 1e9).toString(36);
      
      posts.set(postId, {
        id: postId,
        title: `Post ${postId} • ${titleHash}`,
        content: `Content for post ${postId} • ${contentHash}`,
        authorId: user.id,
        commentIds: [],
        likeCount: Math.floor(rnd() * 1000),
      });
      
      user.postIds.push(postId);
    }
  }

  // Create comments for each post
  let commentCounter = 1;
  const userIds = Array.from(users.keys());
  for (const post of posts.values()) {
    for (let i = 0; i < commentsPerPost; i++) {
      const commentId = `c${commentCounter++}`;
      const randomAuthorId = userIds[Math.floor(rnd() * userIds.length)];
      const textHash = Math.floor(rnd() * 1e6).toString(36);
      
      comments.set(commentId, {
        id: commentId,
        text: `Comment ${commentId} • ${textHash}`,
        authorId: randomAuthorId,
        postId: post.id,
      });
      
      post.commentIds.push(commentId);
    }
  }

  // Assign followers to each user
  for (const user of users.values()) {
    const availableUsers = userIds.filter(id => id !== user.id);
    const followerCount = Math.min(followersPerUser, availableUsers.length);
    
    for (let i = 0; i < followerCount; i++) {
      const randomFollowerId = availableUsers[Math.floor(rnd() * availableUsers.length)];
      if (!user.followerIds.includes(randomFollowerId)) {
        user.followerIds.push(randomFollowerId);
      }
    }
  }

  return { users, posts, comments };
}
