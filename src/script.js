let allFetchedProjects = [];
let sortState = { by: "last_updated", order: "desc" };

async function init() {
  const user = await window.websim.getCreator();
  if (!user) {
    console.error("Could not retrieve creator info.");
    // Maybe display an error message to the user
    return;
  }

  // --- Immediate UI Updates ---
  const userAvatar = document.getElementById("user-avatar");
  userAvatar.src = `https://images.websim.com/avatar/${user.username}`;
  document.getElementById("username").textContent = `@${user.username}`;

  // --- Parallel Data Fetching & Asynchronous UI Updates ---
  loadFollowerCount(user.username);
  loadFollowingCount(user.username);
  loadProjectsAndStats(user.username);

  // --- Initializations ---
  initializeModals();
  initializeTipping();
  initializeProjectControls();
  window.cachedUsers = {
    followers: null,
    following: null,
  };
}

async function loadFollowerCount(username) {
  try {
    const response = await fetch(
      `/api/v1/users/${username}/followers?count=true`
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    document.getElementById("follower-count").textContent =
      data.followers.meta.count.toLocaleString();
  } catch (error) {
    console.error("Failed to load follower count:", error);
    document.getElementById("follower-count").textContent = "N/A";
  }
}

async function loadFollowingCount(username) {
  try {
    const response = await fetch(
      `/api/v1/users/${username}/following?count=true`
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    document.getElementById("following-count").textContent =
      data.following.meta.count.toLocaleString();
  } catch (error) {
    console.error("Failed to load following count:", error);
    document.getElementById("following-count").textContent = "N/A";
  }
}

async function loadProjectsAndStats(username) {
  try {
    const projects = await fetchAllProjects(username);
    const nonProfileProjects = projects.filter(
      ({ project }) => !project.slug?.includes("profile")
    );

    // Store projects with initial tips data for sorting/filtering
    allFetchedProjects = nonProfileProjects.map((p) => ({
      ...p,
      tipsReceived: 0,
    }));

    // Initial render with placeholder data
    renderProjects();

    // Update stats available directly from project data immediately
    let totalViews = 0;
    let totalLikes = 0;
    nonProfileProjects.forEach(({ project }) => {
      totalViews += project.stats.views;
      totalLikes += project.stats.likes;
    });
    document.getElementById("total-views").textContent =
      totalViews.toLocaleString();
    document.getElementById("total-likes").textContent =
      totalLikes.toLocaleString();
    document.getElementById("total-credits").textContent = "0";

    // Fetch detailed stats and update as they arrive
    fetchAndProcessStats(nonProfileProjects);
  } catch (error) {
    console.error("Failed to load projects and stats:", error);
    document.getElementById("projects-grid").innerHTML =
      "<p>Could not load projects.</p>";
  }
}

async function fetchAndProcessStats(projects) {
  let totalCredits = 0;
  document.getElementById("total-credits").textContent = "0";

  const statPromises = projects.map(async (p) => {
    try {
      const statsResponse = await fetch(`/api/v1/projects/${p.project.id}/stats`);
      if (!statsResponse.ok) {
        console.warn(`Could not fetch stats for project ${p.project.id}. Status: ${statsResponse.status}`);
        return; // Skip update for this project
      }
      const statsData = await statsResponse.json();
      const tipsReceived = statsData.total_tip_amount || 0;

      // Update total credits
      totalCredits += tipsReceived;
      document.getElementById("total-credits").textContent = totalCredits.toLocaleString();
      
      // Update the specific project card
      const projectCard = document.querySelector(`.project-card[data-project-id="${p.project.id}"]`);
      if (projectCard) {
          const statsElement = projectCard.querySelector('.project-stats span:last-child');
          if(statsElement) {
              statsElement.textContent = `💎 ${tipsReceived.toLocaleString()}`;
          }
      }

      // Update the project data in our main array
      const projectIndex = allFetchedProjects.findIndex(proj => proj.project.id === p.project.id);
      if (projectIndex !== -1) {
          allFetchedProjects[projectIndex].tipsReceived = tipsReceived;
      }

    } catch (error) {
      console.error(`Error fetching stats for project ${p.project.id}:`, error);
    }
  });

  await Promise.all(statPromises);

  // After all stats are fetched, a re-render might be needed if the user changes sort order.
  // The current implementation re-renders on sort change, which will use the updated allFetchedProjects array.
}

async function fetchAllProjectStats(projects) {
  const projectStatsPromises = projects.map(async ({ project }) => {
    try {
      const statsResponse = await fetch(`/api/v1/projects/${project.id}/stats`);
      if (!statsResponse.ok) {
        console.warn(`Could not fetch stats for project ${project.id}. Status: ${statsResponse.status}`);
        return { projectId: project.id, totalTipAmount: 0 };
      }
      const statsData = await statsResponse.json();
      return {
        projectId: project.id,
        totalTipAmount: statsData.total_tip_amount || 0,
      };
    } catch (error) {
      console.error(`Error fetching stats for project ${project.id}:`, error);
      return { projectId: project.id, totalTipAmount: 0 };
    }
  });

  return Promise.all(projectStatsPromises);
}

async function fetchAllProjects(username) {
  const allProjects = [];
  let hasNextPage = true;
  let afterCursor = null;

  while (hasNextPage) {
    const url = new URL(
      `${window.location.origin}/api/v1/users/${username}/projects`
    );
    url.searchParams.append("posted", "true");
    url.searchParams.append("first", "100"); // Fetch 100 at a time, the max
    if (afterCursor) {
      url.searchParams.append("after", afterCursor);
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      if (!data.projects || !data.projects.data || !data.projects.meta) {
        console.error("Invalid projects data structure from API");
        hasNextPage = false;
        continue;
      }

      allProjects.push(...data.projects.data);

      hasNextPage = data.projects.meta.has_next_page;
      afterCursor = data.projects.meta.end_cursor;
    } catch (error) {
      console.error(`Failed to fetch projects:`, error);
      hasNextPage = false; // Stop fetching on error
    }
  }

  return allProjects;
}

async function initializeTipping() {
  const totalCreditsStatElement = document
    .getElementById("total-credits")
    .closest(".stat");
  if (totalCreditsStatElement) {
    totalCreditsStatElement.style.cursor = "pointer";
    totalCreditsStatElement.addEventListener("click", async () => {
      try {
        await window.websim.postComment({
          content: "Tipping 1000 credits to this amazing profile!",
          credits: 1000,
        });
      } catch (error) {
        console.error("Error tipping credits:", error);
      }
    });
  }
}

async function openModal(type) {
  const username = document.getElementById("username").textContent.slice(1);
  const users = await fetchUsers(type, username);

  let modal = document.querySelector(`#${type}-modal`);
  if (!modal) {
    modal = createModal(type, users);
    document.body.appendChild(modal);
  }

  modal.showModal();
  document.body.style.overflow = "hidden"; // Lock body scroll
}

async function fetchUsers(type, username) {
  // Return cached data if available
  if (window.cachedUsers[type] && window.cachedUsers[type].length > 0) {
    return window.cachedUsers[type];
  }

  const allUsers = [];
  let hasNextPage = true;
  let afterCursor = null;

  while (hasNextPage) {
    const url = new URL(
      `${window.location.origin}/api/v1/users/${username}/${type}`
    );
    url.searchParams.append("first", "100"); // Fetch 100 at a time, the max
    if (afterCursor) {
      url.searchParams.append("after", afterCursor);
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      const collection = type === "followers" ? data.followers : data.following;

      if (!collection || !collection.data || !collection.meta) {
        console.error("Invalid data structure from API");
        hasNextPage = false;
        continue;
      }

      const items = collection.data;

      const users = items.map((item) => {
        const userData = item.follow.user;
        return {
          cursor: item.cursor,
          username: userData.username,
          avatar_url:
            userData.avatar_url ||
            `https://images.websim.com/avatar/${userData.username}`,
          isAdmin: userData.is_admin,
        };
      });

      allUsers.push(...users);

      hasNextPage = collection.meta.has_next_page;
      afterCursor = collection.meta.end_cursor;
    } catch (error) {
      console.error(`Failed to fetch ${type}:`, error);
      hasNextPage = false; // Stop fetching on error
    }
  }

  // Cache the results
  window.cachedUsers[type] = allUsers;
  return allUsers;
}

function createModal(type, users) {
  const modal = document.createElement("dialog");
  modal.className = "modal";
  modal.id = `${type}-modal`;

  const header = document.createElement("div");
  header.className = "modal-header";

  const title = document.createElement("h2");
  title.className = "modal-title";
  title.textContent = type.charAt(0).toUpperCase() + type.slice(1);

  const closeBtn = document.createElement("button");
  closeBtn.className = "close-modal";
  const closeIcon = document.createElement("div");
  closeIcon.className = "close-button-icon";
  closeBtn.appendChild(closeIcon);
  closeBtn.onclick = () => closeModal(modal);

  header.appendChild(title);
  header.appendChild(closeBtn);

  const userList = document.createElement("div");
  userList.className = "user-list";

  users.forEach((user) => {
    userList.appendChild(createUserItem(user));
  });

  modal.appendChild(header);
  modal.appendChild(userList);

  return modal;
}

function createUserItem(user) {
  const userItem = document.createElement("a");
  userItem.className = "user-item";
  userItem.href = `https://websim.com/@${user.username}`;
  userItem.target = "_blank";

  const avatar = document.createElement("img");
  avatar.className = "user-avatar no-select";
  avatar.src = user.avatar_url;
  avatar.alt = `${user.username}'s avatar`;

  const nameContainer = document.createElement("div");
  nameContainer.style.display = "flex";
  nameContainer.style.alignItems = "center";
  nameContainer.style.gap = "8px";

  const name = document.createElement("span");
  name.className = "user-name";
  name.textContent = `@${user.username}`;

  nameContainer.appendChild(name);

  if (user.isAdmin) {
    const adminBadge = document.createElement("span");
    adminBadge.textContent = "Admin";
    adminBadge.style.backgroundColor = "#2a6fd6";
    adminBadge.style.color = "white";
    adminBadge.style.padding = "2px 6px";
    adminBadge.style.borderRadius = "4px";
    adminBadge.style.fontSize = "12px";
    nameContainer.appendChild(adminBadge);
  }

  userItem.appendChild(avatar);
  userItem.appendChild(nameContainer);

  return userItem;
}

function closeModal(modal) {
  modal.close();
  document.body.style.overflow = ""; // Restore body scroll
}

function createProjectCard(project, revision, tipsReceived) {
  const card = document.createElement("a");
  card.className = "project-card";
  card.dataset.projectId = project.id; // Add project ID for easy selection

  const DEFAULT_DOMAIN = 0;
  if (DEFAULT_DOMAIN === 0) {
    card.href =
      project.domains?.length > 0
        ? `https://${project.domains[0].name.replace(".websim.ai", ".websim.com")}`
        : `https://websim.com/p/${project.id}`;
  } else {
    card.href = `https://websim.com/p/${project.id}`;
  }

  card.target = "_blank";

  const thumbnailContainer = document.createElement("div");
  thumbnailContainer.className = "thumbnail-container";

  const thumbnail = document.createElement("img");
  thumbnail.className = "thumbnail no-select";
  thumbnail.alt = `Thumbnail for ${project.title || "Untitled Project"}`;
  thumbnail.src =
    revision.current_screenshot_url ||
    `https://images.websim.com/v1/site/${revision.site_id}/600`;

  thumbnailContainer.appendChild(thumbnail);

  const info = document.createElement("div");
  info.className = "project-info";
  info.innerHTML = `
		<h3>${project.title || "Untitled Project"}</h3>
		<p>${project.description || ""}</p>
		<div class="project-stats">
			<span>👁️ ${project.stats.views.toLocaleString()}</span>
			<span>❤️ ${project.stats.likes.toLocaleString()}</span>
			<span>💬 ${project.stats.comments.toLocaleString()}</span>
			<span>💎 ${tipsReceived.toLocaleString()}</span>
		</div>
	`;

  card.appendChild(thumbnailContainer);
  card.appendChild(info);

  return card;
}

function initializeModals() {
  const followerStat = document.querySelector(".stat:nth-child(1)");
  const followingStat = document.querySelector(".stat:nth-child(2)");

  followerStat.style.cursor = "pointer";
  followingStat.style.cursor = "pointer";

  followerStat.addEventListener("click", () => openModal("followers"));
  followingStat.addEventListener("click", () => openModal("following"));
}

function initializeProjectControls() {
  const sortBySelect = document.getElementById("sort-by");
  const sortOrderBtn = document.getElementById("sort-order");

  sortBySelect.addEventListener("change", (e) => {
    sortState.by = e.target.value;
    renderProjects();
  });

  sortOrderBtn.addEventListener("click", () => {
    sortState.order = sortState.order === "desc" ? "asc" : "desc";
    sortOrderBtn.classList.toggle("asc", sortState.order === "asc");
    renderProjects();
  });
}

function renderProjects() {
  const projectsGrid = document.getElementById("projects-grid");

  // 1. Sort
  const sortedProjects = [...allFetchedProjects].sort((a, b) => {
    let valA, valB;

    switch (sortState.by) {
      case "last_updated":
        valA = new Date(a.project.updated_at);
        valB = new Date(b.project.updated_at);
        break;
      case "last_published":
        valA = new Date(a.project_revision.created_at);
        valB = new Date(b.project_revision.created_at);
        break;
      case "view_count":
        valA = a.project.stats.views;
        valB = b.project.stats.views;
        break;
      case "likes":
        valA = a.project.stats.likes;
        valB = b.project.stats.likes;
        break;
      case "comments":
        valA = a.project.stats.comments;
        valB = b.project.stats.comments;
        break;
      case "credits":
        valA = a.tipsReceived;
        valB = b.tipsReceived;
        break;
      default:
        return 0;
    }

    if (valA < valB) return sortState.order === "asc" ? -1 : 1;
    if (valA > valB) return sortState.order === "asc" ? 1 : -1;
    return 0;
  });

  // 2. Render
  projectsGrid.innerHTML = "";
  sortedProjects.forEach(({ project, project_revision, tipsReceived }) => {
    const card = createProjectCard(project, project_revision, tipsReceived);
    projectsGrid.appendChild(card);
  });
}

init();
