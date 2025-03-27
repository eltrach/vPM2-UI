const prompts = require("prompts");
const config = require("../config");
const { createAdminUser } = require("../services/admin.service");

const username_regex = /^(?=.{4,}$)[a-z0-9_]+$/;
const password_regex = /^(?=.*\d)(?=.*[!@#$%^&*])(?=.*[a-z])(?=.*[A-Z]).{8,}$/;

const questions = [
  {
    type: "text",
    name: "username",
    message: "App Username",
  },
  {
    type: "password",
    name: "password",
    message: "App Password",
  },
  {
    type: "confirm",
    name: "agreed",
    message: "Confirm to create/update admin user ?",
  },
];

const onCancel = (prompt) => {
  console.log("Bye Bye!");
};

(async () => {
  const response = await prompts(questions, { onCancel });
  if (response.agreed) {
    createAdminUser(response.username, response.password);
  }
})();
