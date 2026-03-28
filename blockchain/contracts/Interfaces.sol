// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ── EIP-1271: Standard Signature Validation for Contract Wallets ──────────────
interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes memory signature)
        external view returns (bytes4);
}

// ── ERC-721 Receiver ──────────────────────────────────────────────────────────
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

// ── ERC-165 ───────────────────────────────────────────────────────────────────
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

// ── ERC-721 ───────────────────────────────────────────────────────────────────
interface IERC721 is IERC165 {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function approve(address to, uint256 tokenId) external;
    function setApprovalForAll(address operator, bool approved) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

// ── ERC-721 Metadata ──────────────────────────────────────────────────────────
interface IERC721Metadata is IERC721 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

// ── Minimal Uniswap-V2-style DEX Router ──────────────────────────────────────
interface IDEXRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts);
}
