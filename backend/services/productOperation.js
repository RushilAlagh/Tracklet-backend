const docClient = require("../config/dynamoConfig");
const crypto = require("crypto");

const TABLE_NAME = "Products";
const GSI_NAME = "User_Email-index"; // GSI to fetch user's tracked products

// Function to generate Product_ID from URL
const generateProductID = (productURL) => {
  return crypto.createHash("sha256").update(productURL).digest("hex");
};

// Add a new product tracking entry
const addProduct = async (userEmail, productURL, threshold, timeout) => {
  const productID = generateProductID(productURL);

  const params = {
    TableName: TABLE_NAME,
    Item: {
      Product_ID: productID,
      User_Email: userEmail,
      Product_URL: productURL,
      Threshold_Value: threshold,
      Timeout_Time: timeout, // Timeout in months
      Created_At: new Date().toISOString(),
      NotificationSent: false
    },
  };

  try {
    await docClient.put(params).promise();
    return { message: "Product added successfully!", Product_ID: productID };
  } catch (error) {
    console.error("Error adding product:", error);
    throw new Error("Failed to add product.");
  }
};

//Get all products tracked by a user using GSI
const getUserProducts = async (userEmail) => {
  console.log("Fetching products for user:", userEmail);

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "User_Email = :email",
    ExpressionAttributeValues: {
      ":email": userEmail,
    },
  };

  try {
    const data = await docClient.query(params).promise();
    console.log("Fetched products:", data.Items);
    return data.Items || [];
  } catch (error) {
    console.error("Error fetching user products:", error);
    throw error;
  }
};

//Remove user from product when timeout is reached
const removeUserFromProduct = async (userEmail, productID) => {
  const params = {
    TableName: TABLE_NAME,
    Key: { Product_ID: productID, User_Email: userEmail },
  };

  try {
    await docClient.delete(params).promise();
    return { message: "User removed from product" };
  } catch (error) {
    console.error("Error removing user from product:", error);
    throw new Error("Failed to remove user from product.");
  }
};

//Delete product if no users are tracking it
const deleteProductIfUnused = async (productID) => {
  const params = {
    TableName: TABLE_NAME,
    Key: { Product_ID: productID },
    ConditionExpression: "attribute_not_exists(User_Email)", // Only delete if no users exist
  };

  try {
    await docClient.delete(params).promise();
    return { message: "Product deleted as no users are tracking it" };
  } catch (error) {
    console.error("Error deleting unused product:", error);
    return { message: "Product still tracked by users, not deleted" };
  }
};

//Batch cleanup expired products
const cleanupExpiredProducts = async () => {
  const now = new Date();
  let expiredProducts = [];

  try {
    // Scan all products (Consider paginating for large data sets)
    const allProducts = await docClient.scan({ TableName: TABLE_NAME }).promise();

    for (const product of allProducts.Items) {
      const createdAt = new Date(product.Created_At);
      const timeoutMonths = parseInt(product.Timeout_Time, 10);
      const expiryDate = new Date(createdAt);
      expiryDate.setMonth(expiryDate.getMonth() + timeoutMonths);

      if (now >= expiryDate) {
        expiredProducts.push(product);
      }
    }

    if (expiredProducts.length === 0) {
      console.log("No expired products found.");
      return { message: "No expired products to clean." };
    }

    // Perform batch delete
    const deleteRequests = expiredProducts.map((product) => ({
      DeleteRequest: {
        Key: { Product_ID: product.Product_ID, User_Email: product.User_Email },
      },
    }));

    const batchParams = { RequestItems: { [TABLE_NAME]: deleteRequests } };
    await docClient.batchWrite(batchParams).promise();

    // Delete products that have no users left tracking them
    for (const product of expiredProducts) {
      await deleteProductIfUnused(product.Product_ID);
    }

    console.log(`✅ Cleanup completed: ${expiredProducts.length} products removed.`);
    return { message: `Cleaned up ${expiredProducts.length} expired products.` };
  } catch (error) {
    console.error("Error during cleanup:", error);
    throw new Error("Failed to cleanup expired products.");
  }
};

module.exports = {
  addProduct,
  getUserProducts,
  removeUserFromProduct,
  deleteProductIfUnused,
  cleanupExpiredProducts,
};